/**
 * db.ts — D1 query helpers for the SLA Monitor Worker.
 *
 * All public functions accept a D1Database binding and return typed results.
 * No business logic lives here — just parameterised SQL + type shaping.
 * The stats query (queryStats) is in its own section added in Task 5.
 */

import type { CleanRow } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default / clamp bounds for /api/logs page size. */
export const DEFAULT_PAGE_SIZE = 25;
export const MIN_PAGE_SIZE = 5;
export const MAX_PAGE_SIZE = 200;

// ---------------------------------------------------------------------------
// Shared row types
// ---------------------------------------------------------------------------

export interface LogRow {
  id: number;
  service_id: string;
  service_name: string;
  ts_utc: string;
  status_code: number;
  latency_ms: number | null;
  agent: string;
  region: string;
}

export interface LogsResult {
  rows: LogRow[];
  total: number;
  page: number;
  pageSize: number;
}

// ---------------------------------------------------------------------------
// insertChecks
// ---------------------------------------------------------------------------

/**
 * Wipes previous ingest so a second CSV replaces the first instead of mixing.
 * Two statements in one batch() — counts as a single D1 invocation.
 */
export async function replaceAllData(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM checks"),
    db.prepare("DELETE FROM uploads"),
  ]);
}

/**
 * Batch-inserts cleaned rows into the `checks` table.
 *
 * Uses INSERT OR IGNORE so that rows violating the
 * UNIQUE(service_id, ts_utc, agent) constraint are silently skipped.
 *
 * Free-tier Workers allow ~50 D1 invocations per request. A 30-day file is
 * ~15.5k rows; one statement per row would be hundreds of calls. We pack
 * many rows into each INSERT and many INSERTs into each db.batch() so the
 * 30-day upload stays at ~15 D1 calls.
 */
export async function insertChecks(
  db: D1Database,
  rows: CleanRow[],
  ingestedAt: string
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;

  // 9 bound params per row × 25 rows = 225 (well under SQLite's 999 limit).
  const ROWS_PER_STMT = 25;
  // 30 statements × 25 rows = 750 rows per D1 batch() call.
  const STMTS_PER_BATCH = 30;

  const columns = `(service_id, service_name, ts_utc, status_code,
                    latency_ms, agent, region, ingested_at, latency_notes)`;

  for (let i = 0; i < rows.length; ) {
    const stmts = [];
    for (let s = 0; s < STMTS_PER_BATCH && i < rows.length; s++) {
      const chunk = rows.slice(i, i + ROWS_PER_STMT);
      i += chunk.length;
      const placeholders = chunk.map(() => "(?,?,?,?,?,?,?,?,?)").join(",");
      const binds: (string | number | null)[] = [];
      for (const row of chunk) {
        binds.push(
          row.service_id,
          row.service_name,
          row.ts_utc,
          row.status_code,
          row.latency_ms ?? null,
          row.agent,
          row.region,
          ingestedAt,
          row.latency_notes ?? null
        );
      }
      stmts.push(
        db.prepare(`INSERT OR IGNORE INTO checks ${columns} VALUES ${placeholders}`).bind(...binds)
      );
    }

    const results = await db.batch(stmts);
    for (const result of results) {
      inserted += result.meta.rows_written ?? 0;
    }
  }

  const skipped = Math.max(0, rows.length - inserted);
  return { inserted, skipped };
}

// ---------------------------------------------------------------------------
// insertUpload
// ---------------------------------------------------------------------------

/**
 * Records one row in the `uploads` table for audit/provenance.
 * Called once per POST /api/upload, after all check rows are inserted.
 */
export async function insertUpload(
  db: D1Database,
  filename: string,
  uploadedAt: string,
  rowCount: number,
  rejectedCount: number,
  notes: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO uploads (filename, uploaded_at, row_count, rejected_count, notes)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(filename, uploadedAt, rowCount, rejectedCount, notes)
    .run();
}

// ---------------------------------------------------------------------------
// queryLogs
// ---------------------------------------------------------------------------

/**
 * Returns a paginated page of raw check records.
 *
 * Filtering:
 *   - service: exact match on service_id
 *   - from / to: inclusive UTC ISO range on ts_utc
 *   - date: shorthand for a single UTC calendar day (from=date+T00:00:00Z, to=date+T23:59:59.999Z)
 *     If both `date` and `from`/`to` are provided, `from`/`to` take precedence.
 *
 * Pagination:
 *   - page is 1-indexed.
 *   - pageSize is client-chosen (5–200), default DEFAULT_PAGE_SIZE (25).
 *   - We run a COUNT(*) query first so the UI can show "Page X of Y".
 *     D1 executes both in sequence; the cost is minimal for this dataset size.
 */
export async function queryLogs(
  db: D1Database,
  params: {
    service?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  }
): Promise<LogsResult> {
  const page = Math.max(1, params.page ?? 1);
  const rawSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(MIN_PAGE_SIZE, Number.isFinite(rawSize) ? Math.floor(rawSize) : DEFAULT_PAGE_SIZE)
  );
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  if (params.service) {
    conditions.push("service_id = ?");
    bindings.push(params.service);
  }
  if (params.from) {
    conditions.push("ts_utc >= ?");
    bindings.push(params.from);
  }
  if (params.to) {
    conditions.push("ts_utc <= ?");
    bindings.push(params.to);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // COUNT first — needed for total pages in the UI.
  const countResult = await db
    .prepare(`SELECT COUNT(*) as total FROM checks ${where}`)
    .bind(...bindings)
    .first<{ total: number }>();

  const total = countResult?.total ?? 0;

  // Main data query — sorted newest-first, paginated.
  const dataResult = await db
    .prepare(
      `SELECT id, service_id, service_name, ts_utc, status_code,
              latency_ms, agent, region
       FROM checks ${where}
       ORDER BY ts_utc DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...bindings, pageSize, offset)
    .all<LogRow>();

  return {
    rows: dataResult.results,
    total,
    page,
    pageSize,
  };
}

// ---------------------------------------------------------------------------
// queryStats — types
// ---------------------------------------------------------------------------

export interface Incident {
  start: string;
  end: string;
  duration_min: number;
}

export interface MonthlySla {
  month: string;            // YYYY-MM (UTC calendar month)
  uptime_pct: number;
  compliant: boolean;
}

export interface ServiceStats {
  service_id: string;
  service_name: string;
  total_slots: number;      // unique (service_id, ts_utc) combinations in the date filter
  sla_slots_down: number;   // slots where at least one agent reported non-2xx
  uptime_pct: number;       // period uptime for the current date filter
  monthly_uptime_pct: number; // UTC calendar-month uptime (billing SLA)
  sla_month: string | null; // YYYY-MM used for the 99.9% flag
  sla_compliant: boolean;   // monthly_uptime_pct >= 99.9 — NOT the date-filter window
  sla_months: MonthlySla[];
  error_breakdown: Record<string, number>; // e.g. {"500":3,"999":2} — raw row counts
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  incident_count: number;
  incidents: Incident[];
  last_check_ts: string | null;
}

export interface StatsResult {
  services: ServiceStats[];
  overall: {
    uptime_pct: number;
    sla_compliant: boolean;
    non_compliant_services: string[];
    total_checks: number;   // total raw rows in scope (not deduplicated slots)
    from_ts: string | null;
    to_ts: string | null;
  };
}

// Internal type for rows fetched from D1
interface RawCheckRow {
  service_id: string;
  service_name: string;
  ts_utc: string;
  status_code: number;
  latency_ms: number | null;
}

// ---------------------------------------------------------------------------
// queryStats — implementation
// ---------------------------------------------------------------------------

/**
 * Computes per-service and overall SLA statistics for a given time range.
 *
 * Approach:
 *   1. Fetch all raw check rows for the scope from D1 in one query.
 *      (No aggregation in SQL — we need the raw rows for p50/p95 and incident
 *       detection anyway, and the dataset is small enough to handle in memory.)
 *   2. Group rows by service_id in TypeScript.
 *   3. For each service:
 *      a. Resolve dual-agent slots → per-slot up/down (pessimistic policy)
 *      b. Compute uptime % and SLA compliance
 *      c. Build error breakdown (raw row counts, 999 kept separate from 5xx)
 *      d. Compute p50/p95 latency from valid readings (TypeScript sort + index)
 *      e. Detect incidents (consecutive down slots)
 *
 * Dual-agent SLA policy (documented here because this is where it's enforced):
 *   For any (service_id, ts_utc) slot that has two agent rows, if EITHER agent
 *   reports a non-2xx status code, the slot is counted as DOWN.
 *
 *   Why not MIN(status_code)?
 *     MIN(200, 500) = 200 — would pick the healthy reading, hiding the failure.
 *     That's the wrong direction for a conservative SLA calculation.
 *
 *   We implement this as: isDown = any row in the slot has status_code !== 200.
 *   In SQL terms this is equivalent to:
 *     MAX(CASE WHEN status_code != 200 THEN 1 ELSE 0 END) = 1
 *   We do it in TypeScript because we're already iterating rows for other stats.
 *
 * Incident definition (aligned with dataset_incident_log.json):
 *   The seed log lists sustained outage *windows*, not every failed probe.
 *   Isolated 1-slot 5xx/999 blips are noise — counting them produced 19
 *   "incidents" on svc-reports where the log records 1.
 *
 *   We cluster down slots that are at most 2 slots (30 min) apart into one
 *   burst, then keep a cluster only if it has ≥ 3 down slots. Duration is
 *   wall-clock from the first down to the last down (inclusive of the
 *   15-minute slot). This matches the injected windows in the seed files.
 *
 * SLA flag:
 *   Billing credits use *monthly* availability, not the dashboard date
 *   filter. `sla_compliant` is computed on UTC calendar months. `uptime_pct`
 *   remains the filtered-window figure so a 1-day view still shows that day's
 *   availability.
 *
 * Latency percentiles:
 *   D1 (SQLite) does not have PERCENTILE_CONT. We sort valid latency values in
 *   TypeScript and index directly. This is O(n log n) per service but bounded
 *   by dataset size (~2,000–4,000 valid readings per service per month).
 *
 *   Excluded from percentile calculations:
 *     - NULL latency_ms (blank or negative in source — see parser.ts)
 *   Included: all latency_ms > 0 from all raw rows (both agents where present)
 */
/** UTC calendar month key, e.g. "2025-05". */
function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/**
 * Cluster down slots into seed-log incidents.
 * Downs ≤ 30 min apart belong to the same burst; bursts with < 3 downs are dropped.
 */
export function detectIncidents(
  sortedDownTs: string[]
): Incident[] {
  const MERGE_GAP_MS = 2 * 15 * 60_000; // two 15-min up slots
  const MIN_DOWN_SLOTS = 3;
  const SLOT_MS = 15 * 60_000;

  const incidents: Incident[] = [];
  let start: string | null = null;
  let end: string | null = null;
  let count = 0;

  function flush() {
    if (!start || !end || count < MIN_DOWN_SLOTS) return;
    const durationMin = Math.round(
      (new Date(end).getTime() - new Date(start).getTime() + SLOT_MS) / 60_000
    );
    incidents.push({ start, end, duration_min: durationMin });
  }

  for (const ts of sortedDownTs) {
    if (start === null || end === null) {
      start = end = ts;
      count = 1;
      continue;
    }
    const gap = new Date(ts).getTime() - new Date(end).getTime();
    if (gap <= SLOT_MS + MERGE_GAP_MS) {
      end = ts;
      count++;
    } else {
      flush();
      start = end = ts;
      count = 1;
    }
  }
  flush();
  return incidents;
}

export async function queryStats(
  db: D1Database,
  params: { service?: string; from?: string; to?: string }
): Promise<StatsResult> {
  // Fetch the full service history (date filter applied in JS) so the 99.9%
  // flag can use UTC calendar months even when the UI is showing one day.
  const conditions: string[] = [];
  const bindings: string[] = [];

  if (params.service) {
    conditions.push("service_id = ?");
    bindings.push(params.service);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const allChecks = await db
    .prepare(
      `SELECT service_id, service_name, ts_utc, status_code, latency_ms
       FROM checks ${where}
       ORDER BY service_id, ts_utc ASC`
    )
    .bind(...bindings)
    .all<RawCheckRow>();

  // Group rows by service_id
  const byService = new Map<string, RawCheckRow[]>();
  for (const row of allChecks.results) {
    let bucket = byService.get(row.service_id);
    if (!bucket) {
      bucket = [];
      byService.set(row.service_id, bucket);
    }
    bucket.push(row);
  }

  const services: ServiceStats[] = [];

  for (const [serviceId, checks] of byService) {
    const serviceName = checks[0].service_name;

    // -----------------------------------------------------------------------
    // Step 1: Dual-agent slot resolution
    //
    // Group check rows by ts_utc. For each slot:
    //   - isDown: true if ANY agent reported status_code !== 200.
    //     (This is the pessimistic SLA policy — see the function comment above.)
    //   - latencies: all valid (> 0, non-null) latency_ms values for this slot,
    //     from both agents. Used to build the full service latency array.
    //   - statusCodes: all status codes seen in this slot (for error_breakdown).
    // -----------------------------------------------------------------------
    const slotMap = new Map<
      string,
      { isDown: boolean; latencies: number[]; statusCodes: number[] }
    >();

    for (const check of checks) {
      let slot = slotMap.get(check.ts_utc);
      if (!slot) {
        slot = { isDown: false, latencies: [], statusCodes: [] };
        slotMap.set(check.ts_utc, slot);
      }

      if (check.status_code !== 200) {
        slot.isDown = true;
      }

      slot.statusCodes.push(check.status_code);

      if (check.latency_ms !== null && check.latency_ms > 0) {
        slot.latencies.push(check.latency_ms);
      }
    }

    const inPeriod = (ts: string) =>
      (!params.from || ts >= params.from) && (!params.to || ts <= params.to);

    const periodSlots = [...slotMap.entries()].filter(([ts]) => inPeriod(ts));
    if (periodSlots.length === 0) continue;
    const periodChecks = checks.filter((c) => inPeriod(c.ts_utc));

    function uptimeOf(slots: Iterable<{ isDown: boolean }>): number {
      const list = [...slots];
      if (list.length === 0) return 100;
      const down = list.filter((s) => s.isDown).length;
      return ((list.length - down) / list.length) * 100;
    }

    const totalSlots = periodSlots.length;
    const downSlots = periodSlots.filter(([, s]) => s.isDown).length;
    const uptimePct = uptimeOf(periodSlots.map(([, s]) => s));

    // Calendar-month SLA — uses every slot in each UTC month, not the filter.
    const byMonth = new Map<string, { isDown: boolean }[]>();
    for (const [ts, slot] of slotMap) {
      const key = monthKey(ts);
      let bucket = byMonth.get(key);
      if (!bucket) {
        bucket = [];
        byMonth.set(key, bucket);
      }
      bucket.push(slot);
    }

    const fromMonth = params.from ? monthKey(params.from) : null;
    const toMonth = params.to ? monthKey(params.to) : null;
    const slaMonths: MonthlySla[] = [...byMonth.entries()]
      .filter(([m]) => (!fromMonth || m >= fromMonth) && (!toMonth || m <= toMonth))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, slots]) => {
        const pct = Math.round(uptimeOf(slots) * 1000) / 1000;
        return { month, uptime_pct: pct, compliant: pct >= 99.9 };
      });

    const monthlyUptime =
      slaMonths.length > 0
        ? Math.min(...slaMonths.map((m) => m.uptime_pct))
        : 100;
    const slaMonth = slaMonths.length === 1
      ? slaMonths[0].month
      : slaMonths.find((m) => !m.compliant)?.month ?? slaMonths[0]?.month ?? null;

    const errorBreakdown: Record<string, number> = {};
    for (const check of periodChecks) {
      if (check.status_code !== 200) {
        const key = String(check.status_code);
        errorBreakdown[key] = (errorBreakdown[key] ?? 0) + 1;
      }
    }

    const allLatencies = periodSlots
      .flatMap(([, s]) => s.latencies)
      .sort((a, b) => a - b);

    function percentile(sorted: number[], p: number): number | null {
      if (sorted.length === 0) return null;
      const idx = Math.ceil((p / 100) * sorted.length) - 1;
      return sorted[Math.max(0, idx)];
    }

    const p50 = percentile(allLatencies, 50);
    const p95 = percentile(allLatencies, 95);

    const downTs = periodSlots.filter(([, s]) => s.isDown).map(([ts]) => ts);
    const incidents = detectIncidents(downTs);

    const lastCheckTs =
      periodSlots.length > 0 ? periodSlots[periodSlots.length - 1][0] : null;

    services.push({
      service_id: serviceId,
      service_name: serviceName,
      total_slots: totalSlots,
      sla_slots_down: downSlots,
      uptime_pct: Math.round(uptimePct * 1000) / 1000,
      monthly_uptime_pct: monthlyUptime,
      sla_month: slaMonth,
      sla_compliant: slaMonths.every((m) => m.compliant),
      sla_months: slaMonths,
      error_breakdown: errorBreakdown,
      p50_latency_ms: p50 !== null ? Math.round(p50 * 10) / 10 : null,
      p95_latency_ms: p95 !== null ? Math.round(p95 * 10) / 10 : null,
      incident_count: incidents.length,
      incidents,
      last_check_ts: lastCheckTs,
    });
  }

  // -------------------------------------------------------------------------
  // Overall stats
  // -------------------------------------------------------------------------
  const allUptimes = services.map((s) => s.uptime_pct);
  const overallUptime =
    allUptimes.length > 0
      ? allUptimes.reduce((a, b) => a + b, 0) / allUptimes.length
      : 100;

  const nonCompliant = services
    .filter((s) => !s.sla_compliant)
    .map((s) => s.service_id);

  // Derive the actual date range covered by the data in scope.
  //
  // We cannot use allTs[0] / allTs[last] here because the SQL query is
  // ORDER BY service_id, ts_utc — rows are sorted by service name first,
  // then by time *within* each service. That means:
  //   allTs[0]   = earliest ts of the first alphabetical service (e.g. svc-auth)
  //   allTs[last] = latest ts of the last alphabetical service (e.g. svc-search)
  // Neither is guaranteed to be the global minimum/maximum across all services.
  //
  // UTC ISO 8601 strings sort lexicographically in the same order as their
  // chronological values, so a simple string comparison in reduce() is correct.
  const periodRows = allChecks.results.filter(
    (r) =>
      (!params.from || r.ts_utc >= params.from) &&
      (!params.to || r.ts_utc <= params.to)
  );
  const allTs = periodRows.map((r) => r.ts_utc);
  const fromTs = allTs.length > 0
    ? allTs.reduce((min, t) => (t < min ? t : min))
    : null;
  const toTs = allTs.length > 0
    ? allTs.reduce((max, t) => (t > max ? t : max))
    : null;

  return {
    services,
    overall: {
      uptime_pct: Math.round(overallUptime * 1000) / 1000,
      sla_compliant: nonCompliant.length === 0,
      non_compliant_services: nonCompliant,
      total_checks: periodRows.length,
      from_ts: fromTs,
      to_ts: toTs,
    },
  };
}
