-- =============================================================================
-- SLA Monitor — initial schema
-- Applied via: npx wrangler d1 migrations apply sla-monitor [--local]
-- =============================================================================

-- checks: one row per raw health-check reading as reported by a single agent.
--
-- Design notes:
--   • We store BOTH rows for any (service_id, ts_utc) slot that has two agents
--     reporting. The SLA interpretation (pessimistic: if EITHER agent reports
--     non-2xx, the slot counts as down) is applied at query time in src/db.ts,
--     not at ingest time. This keeps raw data intact and the policy auditable.
--
--   • ts_utc is always stored as UTC ISO 8601 (e.g. "2025-05-13T12:45:00.000Z").
--     The parser normalises Unix epoch integers, non-UTC ISO offsets (e.g.
--     +05:30), and plain UTC strings to this format before insertion.
--
--   • latency_ms is REAL (nullable). NULL means either the source value was
--     blank (~1% of rows) or negative (instrument noise). NULL rows are
--     excluded from p50/p95 calculations but still counted toward uptime.
--     See src/parser.ts for the full rationale.
--
--   • status_code 999 is stored as-is. It is not a real HTTP status; it is a
--     sentinel the monitoring agent emits on probe timeout. The dashboard
--     renders it in a separate "Probe Failures" bucket so it is never hidden
--     inside 5xx counts.
CREATE TABLE IF NOT EXISTS checks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id   TEXT    NOT NULL,
  service_name TEXT    NOT NULL,
  ts_utc       TEXT    NOT NULL,  -- UTC ISO 8601, always normalised by parser
  status_code  INTEGER NOT NULL,  -- 200 | 500 | 502 | 503 | 999 (probe failure)
  latency_ms   REAL,              -- NULL when blank or negative in source
  agent        TEXT    NOT NULL,  -- "agent-1" or "agent-2"
  region       TEXT    NOT NULL,
  ingested_at  TEXT    NOT NULL,  -- UTC ISO, set at ingest time by the Worker

  -- UNIQUE constraint on (service_id, ts_utc, agent):
  --   • Prevents re-ingesting the same agent's reading for the same slot.
  --   • Also handles exact full-row duplicates: a literal duplicate has the
  --     same triple and is silently dropped by INSERT OR IGNORE.
  --   • We use INSERT OR IGNORE rather than a manual dedup step in the parser
  --     so that skipped rows are countable from D1's rows_written metadata
  --     rather than requiring application-level set logic.
  UNIQUE (service_id, ts_utc, agent)
);

-- Covering index for stats queries: filter by service_id + time range.
-- Covers the GROUP BY (service_id, ts_utc) pattern used in dual-agent resolution.
CREATE INDEX IF NOT EXISTS idx_checks_service_ts
  ON checks (service_id, ts_utc);

-- Index for logs queries that filter by time range across all services.
CREATE INDEX IF NOT EXISTS idx_checks_ts
  ON checks (ts_utc);

-- uploads: one row per CSV ingest batch, for audit and provenance.
--
-- row_count      = rows successfully inserted into checks
-- rejected_count = parse-time rejections + DB-level duplicate skips
-- notes          = JSON array of up to 5 rejection reason strings (human-readable)
CREATE TABLE IF NOT EXISTS uploads (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  filename       TEXT,
  uploaded_at    TEXT    NOT NULL,  -- UTC ISO
  row_count      INTEGER NOT NULL,
  rejected_count INTEGER NOT NULL,
  notes          TEXT                -- JSON string, e.g. '["blank_latency x3","duplicate x12"]'
);
