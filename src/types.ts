// Shared TypeScript types for the Worker (src/index.ts, parser.ts, db.ts)

/** A single health-check row after parsing and cleaning. */
export interface CleanRow {
  service_id: string;
  service_name: string;
  ts_utc: string; // always UTC ISO 8601, e.g. "2025-05-13T12:45:00.000Z"
  status_code: number;
  latency_ms: number | null; // null when blank or negative in source — see parser.ts
  agent: string;
  region: string;
  latency_notes: string | null; // explains why latency_ms is null when it is
}

/** A row that failed validation during parsing. */
export interface RejectedRow {
  raw: string;
  reason: string;
}

/** Return value of parseCSV(). */
export interface ParseResult {
  rows: CleanRow[];
  rejected: RejectedRow[];
}

/** Cloudflare Worker environment bindings. */
export interface Env {
  DB: D1Database;
  ENVIRONMENT?: string;
}
