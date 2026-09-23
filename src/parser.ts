/**
 * parser.ts — CSV parsing and data cleaning for SLA monitoring logs.
 *
 * This file is the interview-defensible core of the project. Every data quality
 * decision is documented inline. The function signature is intentionally simple:
 * input text → { rows, rejected }. No side effects, no I/O, fully unit-testable.
 *
 * Data quality issues handled (all confirmed in the actual dataset):
 *   1. Unix epoch timestamps (pure integer string, e.g. "1746938700")
 *   2. ISO 8601 with non-UTC timezone offset (e.g. "2025-05-13T02:00:00+05:30")
 *   3. Mixed latency units: "ms" or "s" per row
 *   4. Blank latency (~1% of rows) → store NULL
 *   5. Negative latency (instrument noise) → store NULL, keep row
 *   6. status_code 999 (probe timeout sentinel, not a real HTTP status)
 *   7. Dual-agent rows: same (service_id, timestamp), two agents
 *      — stored as two separate rows; SLA resolution at query time
 *   8. Exact full-row duplicates
 *      — handled by UNIQUE(service_id, ts_utc, agent) + INSERT OR IGNORE in db.ts
 *   9. CRLF line endings
 */

import type { CleanRow, ParseResult, RejectedRow } from "./types";

// ---------------------------------------------------------------------------
// Required columns — matched by name (case-insensitive), not by position.
// This makes the parser robust to column reordering across different CSV exports.
// ---------------------------------------------------------------------------
const REQUIRED_COLUMNS = [
  "service_id",
  "service_name",
  "timestamp",
  "status_code",
  "latency",
  "latency_unit",
  "agent",
  "region",
] as const;

type ColName = typeof REQUIRED_COLUMNS[number];

// ---------------------------------------------------------------------------
// Timestamp normalisation
// ---------------------------------------------------------------------------

/**
 * Normalises a raw timestamp string to UTC ISO 8601.
 *
 * Three formats are present in the dataset:
 *
 *   1. Unix epoch seconds — a string of only digits with no separators,
 *      e.g. "1746938700". JavaScript Date expects milliseconds, so we multiply
 *      by 1000. We also guard against 13-digit millisecond epochs just in case.
 *
 *   2. ISO 8601 with a non-UTC timezone offset, e.g. "2025-05-13T02:00:00+05:30".
 *      This is technically valid ISO 8601, but storing the offset as-is would
 *      make SQL range comparisons incorrect (string sort ≠ chronological sort
 *      when offsets differ). The JavaScript Date constructor parses the offset
 *      correctly and converts to UTC internally. Calling .toISOString() always
 *      returns UTC, so we get uniform storage for free.
 *
 *   3. Plain UTC ISO 8601, e.g. "2025-05-13T12:45:00Z". Passed through Date
 *      for validation; .toISOString() is a no-op in terms of value.
 *
 * Returns null if the value cannot be resolved to a valid date.
 */
function normalizeTimestamp(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  // Issue 1: detect Unix epoch — only digits, 9–13 chars (covers seconds and ms).
  // We use a strict regex to avoid treating e.g. "20250513" as an epoch.
  if (/^\d{9,13}$/.test(trimmed)) {
    // 10-digit = seconds; 13-digit = milliseconds
    const ms =
      trimmed.length <= 10
        ? parseInt(trimmed, 10) * 1000
        : parseInt(trimmed, 10);
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  // Issues 2 & 3: ISO 8601 (UTC or with offset).
  // new Date() handles both "...Z" and "...+05:30" correctly.
  const d = new Date(trimmed);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// ---------------------------------------------------------------------------
// Latency normalisation
// ---------------------------------------------------------------------------

/**
 * Normalises a (latency, latency_unit) pair to a value in milliseconds.
 *
 * Returns { value, note } where:
 *   - value is the normalised ms value, or null for invalid/missing readings
 *   - note is a short string explaining why value is null (for the uploads.notes
 *     audit trail and the latency_notes column on the check row)
 *
 * Policies:
 *   Issue 3 — mixed units: multiply seconds by 1000, pass ms through unchanged.
 *   Issue 4 — blank latency: return null + "blank_latency".
 *     Rationale: fabricating a value (e.g. mean imputation) would silently
 *     distort p50/p95 latency stats. NULL is the honest representation.
 *   Issue 5 — negative latency: return null + "negative_latency", but the
 *     CALLER keeps the row. The status_code is still valid and still counts
 *     toward uptime/downtime. Only the latency reading is corrupt.
 */
function normalizeLatency(
  rawLatency: string,
  rawUnit: string
): { value: number | null; note: string | null } {
  const trimmed = rawLatency.trim();

  // Issue 4: blank latency — prefer NULL over imputation.
  if (trimmed === "") {
    return { value: null, note: "blank_latency" };
  }

  const num = parseFloat(trimmed);

  if (isNaN(num)) {
    return { value: null, note: `unparseable_latency:${trimmed}` };
  }

  // Issue 5: negative latency — instrument noise / clock skew.
  // The row is NOT rejected; latency_ms is set to null so this reading
  // is excluded from p50/p95 calculations without losing the status_code.
  if (num < 0) {
    return { value: null, note: "negative_latency" };
  }

  const unit = rawUnit.trim().toLowerCase();

  // Issue 3: unit normalisation.
  if (unit === "s") {
    // Convert seconds → milliseconds for uniform storage.
    return { value: num * 1000, note: null };
  }

  if (unit === "ms") {
    return { value: num, note: null };
  }

  // Unknown unit — treat as unparseable rather than guessing a conversion.
  return { value: null, note: `unknown_latency_unit:${rawUnit.trim()}` };
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parses a raw CSV text string into cleaned rows and a list of rejected rows.
 *
 * Column matching is by **header name** (case-insensitive), not by position.
 * This means a CSV whose columns appear in a different order, or whose header
 * uses mixed case (e.g. "Service_ID"), will still be parsed correctly.
 * If any required column is absent from the header the entire parse is aborted
 * and an error is returned via the rejected array.
 *
 * Required columns (any order, case-insensitive):
 *   service_id, service_name, timestamp, status_code,
 *   latency, latency_unit, agent, region
 *
 * Returns:
 *   rows     — CleanRow[] ready for INSERT OR IGNORE into D1
 *   rejected — RejectedRow[] with human-readable reasons (reported back to the
 *              upload UI and stored in uploads.notes)
 *
 * What causes a row to be REJECTED (not inserted):
 *   - Any required column missing from the header (whole-file error)
 *   - Fewer comma-separated fields than the header has columns
 *   - Any of service_id, service_name, agent, region is empty
 *   - Unparseable timestamp
 *   - Non-numeric status_code
 *
 * What causes latency_ms to be NULL but the row to be KEPT:
 *   - Blank latency (issue 4)
 *   - Negative latency (issue 5)
 *   - Unknown latency unit (treated conservatively)
 *
 * Issue 6 (status_code 999) — no special handling here. The row is accepted
 * and stored as-is. 999 is a valid data point (probe failure/timeout); it is
 * the dashboard's job to render it distinctly from real 5xx codes.
 *
 * Issue 7 (dual-agent rows) — no dedup or merging here. Both rows are returned
 * in `rows`. The SLA resolution policy (pessimistic: if either agent reports
 * non-2xx, the slot is down) is applied at query time in db.ts / queryStats.
 * Keeping raw rows intact means the policy is auditable and changeable without
 * re-ingesting data.
 *
 * Issue 8 (exact full-row duplicates) — not deduplicated here. The DB layer
 * uses INSERT OR IGNORE with UNIQUE(service_id, ts_utc, agent) to handle them.
 * This keeps the parser stateless and avoids building a Set over potentially
 * ~15k rows just to catch a handful of duplicates.
 */
export function parseCSV(text: string): ParseResult {
  // Issue 9: CRLF line endings.
  // Some files use Windows-style \r\n, others use Unix \n, and a few may have
  // lone \r (old Mac line endings). Normalise all variants to \n before
  // splitting so the field parser never sees a trailing \r on the last field.
  const normalised = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalised.split("\n");

  const rows: CleanRow[] = [];
  const rejected: RejectedRow[] = [];

  if (lines.length === 0 || lines[0].trim() === "") {
    rejected.push({ raw: "", reason: "empty_file_or_missing_header" });
    return { rows, rejected };
  }

  // ---------------------------------------------------------------------------
  // Build a column-name → index map from the header row.
  // Matching is case-insensitive so "Service_ID", "service_id", "SERVICE_ID"
  // all resolve to the same column. Trailing whitespace and BOM chars are
  // stripped before comparison.
  // ---------------------------------------------------------------------------
  const headerFields = lines[0].split(",").map((f) =>
    f.trim().toLowerCase().replace(/^\uFEFF/, "") // strip UTF-8 BOM if present
  );

  const colIndex: Partial<Record<ColName, number>> = {};
  for (const col of REQUIRED_COLUMNS) {
    const idx = headerFields.indexOf(col);
    if (idx !== -1) {
      colIndex[col] = idx;
    }
  }

  // Check that every required column was found.
  const missingCols = REQUIRED_COLUMNS.filter((c) => colIndex[c] === undefined);
  if (missingCols.length > 0) {
    rejected.push({
      raw: lines[0],
      reason: `missing_required_columns:${missingCols.join(",")}`,
    });
    return { rows, rejected };
  }

  // All required columns found — cast to the full record type now.
  const col = colIndex as Record<ColName, number>;

  // ---------------------------------------------------------------------------
  // Parse data rows
  // ---------------------------------------------------------------------------
  const dataLines = lines.slice(1).filter((l) => l.trim() !== "");

  for (const line of dataLines) {
    // Naive comma split — valid for this schema because none of the fields
    // contain quoted commas. If the schema ever changes to include free-text
    // fields, replace this with a proper RFC 4180 parser.
    const fields = line.split(",");

    if (fields.length <= Math.max(...Object.values(col))) {
      rejected.push({ raw: line, reason: "too_few_fields" });
      continue;
    }

    // Extract by name-resolved index.
    const rawServiceId   = fields[col.service_id];
    const rawServiceName = fields[col.service_name];
    const rawTimestamp   = fields[col.timestamp];
    const rawStatusCode  = fields[col.status_code];
    const rawLatency     = fields[col.latency];
    const rawLatencyUnit = fields[col.latency_unit];
    const rawAgent       = fields[col.agent];
    // The last mapped column might have trailing \r from a CRLF file; trim it.
    const rawRegion      = fields[col.region];

    // Validate required string fields.
    const service_id   = rawServiceId?.trim();
    const service_name = rawServiceName?.trim();
    const agent        = rawAgent?.trim();
    const region       = rawRegion?.trim();

    if (!service_id || !service_name || !agent || !region) {
      rejected.push({ raw: line, reason: "missing_required_field" });
      continue;
    }

    // Issues 1 & 2: timestamp normalisation.
    const ts_utc = normalizeTimestamp(rawTimestamp ?? "");
    if (!ts_utc) {
      rejected.push({
        raw: line,
        reason: `unparseable_timestamp:${rawTimestamp?.trim()}`,
      });
      continue;
    }

    // Validate status_code.
    // We require an all-digit string before calling parseInt because parseInt
    // is too lenient — parseInt("2OO", 10) returns 2 rather than NaN, which
    // would silently accept garbled data as a valid status code.
    const rawStatusTrimmed = rawStatusCode?.trim() ?? "";
    if (!/^\d+$/.test(rawStatusTrimmed)) {
      rejected.push({
        raw: line,
        reason: `invalid_status_code:${rawStatusTrimmed}`,
      });
      continue;
    }
    const status_code = parseInt(rawStatusTrimmed, 10);
    // Issue 6: status_code 999 is accepted as-is.
    // It is a monitoring-agent sentinel for probe timeout / connection failure,
    // not a real HTTP status code. We store it so the dashboard can bucket it
    // separately from real 5xx responses. Treating it as a rejection would
    // silently discard downtime events.

    // Issues 3, 4, 5: latency normalisation.
    const { value: latency_ms, note: latency_notes } = normalizeLatency(
      rawLatency ?? "",
      rawLatencyUnit ?? ""
    );

    rows.push({
      service_id,
      service_name,
      ts_utc,
      status_code,
      latency_ms,
      agent,
      region,
      latency_notes,
    });
  }

  return { rows, rejected };
}
