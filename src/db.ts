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
 * Batch-inserts cleaned rows into the `checks` table.
 *
 * Uses INSERT OR IGNORE so that rows violating the
 * UNIQUE(service_id, ts_utc, agent) constraint are silently skipped.
 * This handles two cases:
 *   a) Exact full-row duplicates within the uploaded file (Issue 8)
 *   b) Re-uploading a file that was already ingested
 *
 * We detect skips by checking rows_written in D1's result metadata.
 * A batch() call sends all statements in one HTTP round-trip to D1,
 * which is significantly more efficient than individual .run() calls.
 *
 * Rows are chunked at 100 per batch to stay within D1's statement limits
 * and to keep individual batch CPU time short.
 */
export async function insertChecks(
  db: D1Database,
  rows: CleanRow[],
  ingestedAt: string
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  const CHUNK_SIZE = 100;

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);

    const stmts = chunk.map((row) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO checks
             (service_id, service_name, ts_utc, status_code,
              latency_ms, agent, region, ingested_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          row.service_id,
          row.service_name,
          row.ts_utc,
          row.status_code,
          row.latency_ms ?? null, // explicit null — D1 bind() treats undefined as NULL too,
          //                         but being explicit avoids surprises if types drift
          row.agent,
          row.region,
          ingestedAt
        )
    );

    const results = await db.batch(stmts);

    for (const result of results) {
      // rows_written = 0 when INSERT OR IGNORE skips a duplicate
      if ((result.meta.rows_written ?? 0) > 0) {
        inserted++;
      } else {
        skipped++;
      }
    }
  }

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

export interface ServiceStats {
  service_id: string;
  service_name: string;
  total_slots: number;      // unique (service_id, ts_utc) combinations in range
  sla_slots_down: number;   // slots where at least one agent reported non-2xx
  uptime_pct: number;       // (total_slots - sla_slots_down) / total_slots * 100
  sla_compliant: boolean;   // uptime_pct >= 99.9
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
 * Incident definition:
 *   An unbroken sequence of consecutive down slots for a service.
 *   "Consecutive" means adjacent 15-minute timestamps with no up slot between.
 *   Duration = slot count × 15 minutes.
 *
 *   We rely on slot timestamps being exact multiples of 15 minutes (which they
 *   are in this dataset). We don't try to infer gaps from wall-clock time;
 *   instead, a single up slot between two down runs terminates the first
 *   incident and starts a fresh one.
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
export async function queryStats(
  db: D1Database,
  params: { service?: string; from?: string; to?: string }
): Promise<StatsResult> {
  // Build WHERE clause
  const conditions: string[] = [];
  const bindings: string[] = [];

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

  // Single query — fetch all raw check rows for the requested scope.
  // ORDER BY service_id, ts_utc so the incident detection walk is already sorted.
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

      // Pessimistic policy: if ANY agent in this slot reports non-2xx → down.
      // Equivalent to MAX(CASE WHEN status_code != 200 THEN 1 ELSE 0 END) = 1.
      if (check.status_code !== 200) {
        slot.isDown = true;
      }

      slot.statusCodes.push(check.status_code);

      // Collect valid latency readings. NULL and negative values were already
      // set to null by the parser (see parser.ts issues 4 and 5); we skip them
      // here to keep them out of percentile calculations.
      if (check.latency_ms !== null && check.latency_ms > 0) {
        slot.latencies.push(check.latency_ms);
      }
    }

    // -----------------------------------------------------------------------
    // Step 2: Uptime % and SLA compliance
    // -----------------------------------------------------------------------
    const totalSlots = slotMap.size;
    const downSlots = [...slotMap.values()].filter((s) => s.isDown).length;
    const uptimePct =
      totalSlots > 0
        ? ((totalSlots - downSlots) / totalSlots) * 100
        : 100;

    // -----------------------------------------------------------------------
    // Step 3: Error breakdown — raw row counts, NOT deduplicated by slot.
    //
    // We count every non-200 raw row so the dashboard can show "how many
    // individual agent readings were failures." 999 (probe failure) is kept
    // in its own bucket and never merged with 5xx codes.
    // -----------------------------------------------------------------------
    const errorBreakdown: Record<string, number> = {};
    for (const check of checks) {
      if (check.status_code !== 200) {
        const key = String(check.status_code);
        errorBreakdown[key] = (errorBreakdown[key] ?? 0) + 1;
      }
    }

    // -----------------------------------------------------------------------
    // Step 4: Latency percentiles (p50, p95)
    //
    // Flatten all valid latency values across all slots (both agents), sort,
    // then index. Using ceil-based index so e.g. p50 of a 4-element array
    // picks index 2 (the median on the high side), which matches common
    // "nearest rank" percentile definitions.
    // -----------------------------------------------------------------------
    const allLatencies = [...slotMap.values()]
      .flatMap((s) => s.latencies)
      .sort((a, b) => a - b);

    function percentile(sorted: number[], p: number): number | null {
      if (sorted.length === 0) return null;
      const idx = Math.ceil((p / 100) * sorted.length) - 1;
      return sorted[Math.max(0, idx)];
    }

    const p50 = percentile(allLatencies, 50);
    const p95 = percentile(allLatencies, 95);

    // -----------------------------------------------------------------------
    // Step 5: Incident detection
    //
    // Walk the chronologically sorted slot list. An incident starts when we
    // encounter the first down slot and ends when we encounter an up slot (or
    // reach the end of the range). Duration = slot_count × 15 minutes.
    //
    // We assume slots are spaced 15 minutes apart. If a service has a gap in
    // its data (no check at a particular 15-min mark), that gap is invisible
    // here — it won't create a phantom incident, and it won't extend the
    // duration of an adjacent incident. This matches the dataset's structure
    // where missing slots mean "no data", not "definitely up or down."
    // -----------------------------------------------------------------------
    // slotMap was built in ts_utc order (the SQL ORDER BY guarantees this)
    const sortedSlots = [...slotMap.entries()]; // already sorted by ts_utc

    const incidents: Incident[] = [];
    let incidentStart: string | null = null;
    let incidentEnd: string | null = null;
    let incidentSlotCount = 0;

    for (const [ts, slot] of sortedSlots) {
      if (slot.isDown) {
        if (incidentStart === null) {
          incidentStart = ts; // first down slot in this run
        }
        incidentEnd = ts;
        incidentSlotCount++;
      } else {
        // Up slot — flush any open incident
        if (incidentStart !== null && incidentEnd !== null) {
          incidents.push({
            start: incidentStart,
            end: incidentEnd,
            duration_min: incidentSlotCount * 15,
          });
        }
        incidentStart = null;
        incidentEnd = null;
        incidentSlotCount = 0;
      }
    }
    // Flush an incident still open at the end of the range
    if (incidentStart !== null && incidentEnd !== null) {
      incidents.push({
        start: incidentStart,
        end: incidentEnd,
        duration_min: incidentSlotCount * 15,
      });
    }

    const lastCheckTs =
      sortedSlots.length > 0
        ? sortedSlots[sortedSlots.length - 1][0]
        : null;

    services.push({
      service_id: serviceId,
      service_name: serviceName,
      total_slots: totalSlots,
      sla_slots_down: downSlots,
      uptime_pct: Math.round(uptimePct * 1000) / 1000, // 3 decimal places
      sla_compliant: uptimePct >= 99.9,
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
  const allTs = allChecks.results.map((r) => r.ts_utc);
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
      sla_compliant: overallUptime >= 99.9,
      non_compliant_services: nonCompliant,
      total_checks: allChecks.results.length,
      from_ts: fromTs,
      to_ts: toTs,
    },
  };
}
