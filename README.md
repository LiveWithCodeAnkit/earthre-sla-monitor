# SLA Monitoring Dashboard

A full-stack SLA monitoring tool that ingests health-check CSVs, stores cleaned data in a cloud database, and surfaces per-service uptime, error breakdowns, latency percentiles, and incident timelines on a single-page dashboard.

**Live URL:** https://sla-dashboard-55v.pages.dev  
**Worker API:** https://sla-monitor.ay-opash.workers.dev  
**Health check:** https://sla-monitor.ay-opash.workers.dev/health

---

## Architecture

```
CSV file
  └─▶  Upload UI  (Cloudflare Pages)
         │  POST /api/upload (multipart/form-data)
         ▼
       Cloudflare Worker  (TypeScript, stateless)
         ├─ parseCSV()  — cleans all 9 data quality issues (see below)
         ├─ INSERT OR IGNORE → D1  (Cloudflare's SQLite at the edge)
         └─ returns { row_count, rejected_count, rejected_sample }
                  │
                  ▼
              Cloudflare D1  (SQLite)
                  │
         ┌────────┴────────┐
         ▼                 ▼
  GET /api/stats     GET /api/logs
  (aggregated SLA    (paginated raw
   stats + incidents) check records)
         │                 │
         └────────┬────────┘
                  ▼
       Dashboard UI  (Cloudflare Pages)
         ├─ Collapsible stats panel
         │    per-service: uptime %, SLA flag, error breakdown,
         │    p50/p95 latency, incidents, last-check freshness
         └─ Logs table (filterable, paginated, 50 rows/page)
```

### Why these choices

**Cloudflare Worker** — the assignment requires a real deployed stateless serverless function (not a local process). Workers run on Cloudflare's global edge, deploy in seconds with `wrangler deploy`, and the free tier covers 100 k requests/day. No server to manage, no cold-start lag, no credit card.

**Cloudflare D1** — SQLite collocated with the Worker. D1 bindings are in-process from the Worker's perspective; there is no extra network hop between the function and its database. Free tier covers 5 million row reads/day and 100 k writes/day — comfortably above this project's needs. Schema is a single migration file, easy to reproduce.

**Cloudflare Pages** — free static hosting with automatic HTTPS and a global CDN. The frontend is a plain React/Vite SPA; no SSR needed, so Pages is the simplest possible deploy target: `wrangler pages deploy dist`.

**No Worker framework (Hono/itty-router)** — there are only three routes. Adding a routing framework would be more surface to explain in an interview than the 30 lines of manual dispatch that exist today.

---

## Data Findings

The CSVs look clean at first glance but contain at least nine distinct data quality issues. All are handled explicitly in `src/parser.ts` with inline comments explaining the decision.

### 1 — Unix epoch timestamps
Some `timestamp` values are raw integers (e.g. `1746938700`) rather than ISO 8601 strings. Detected by a `/^\d{9,13}$/` regex. Converted by multiplying 10-digit values by 1000 (seconds → ms) before passing to `new Date()`. 13-digit values are treated as already in milliseconds. Both are stored as UTC ISO strings.

### 2 — Non-UTC ISO timezone offsets _(additional finding, not in original spec)_
While normalising timestamps I found strings like `2025-05-13T02:00:00+05:30`. These are technically valid ISO 8601 but storing them as-is would make SQL `ts_utc >= ?` range comparisons incorrect (string lexicographic order ≠ chronological order when offsets differ). The JavaScript `Date` constructor handles offset conversion to UTC automatically; calling `.toISOString()` always emits a `Z`-suffixed UTC string. This is a free fix — but it's worth calling out because silently ingesting offset-bearing timestamps and querying them as if they were UTC would produce subtly wrong uptime numbers.

### 3 — Mixed latency units
`latency_unit` is `"ms"` for most rows but `"s"` for search-api rows. The unit is per-row, not per-file or per-service. Values in seconds are multiplied by 1000 before storage so `latency_ms` is always in milliseconds.

### 4 — Blank latency (~1% of rows)
Some rows have an empty `latency` field. Policy: store `NULL`, do not impute a value. Reason: substituting a mean or zero would silently distort p50/p95 latency statistics. NULL rows are excluded from percentile calculations but still count toward uptime/downtime.

### 5 — Negative latency
A small number of rows have negative latency values (e.g. `-286`). Likely instrument noise or NTP clock skew. Policy: set `latency_ms = NULL` and note `"negative_latency"` on the row, but keep the row — the `status_code` is still valid and still counts for SLA purposes. Only the latency reading is discarded.

### 6 — status_code 999 (probe failure sentinel)
`999` is not a real HTTP status code. It is a sentinel value the monitoring agent emits when a probe times out or fails to connect — distinct from a server returning a `5xx` response. Policy: accept the row as-is. In stats, `999` is counted as "down" for SLA purposes but displayed in its own **Probe Failures** row in the error breakdown table — it is never merged with `500`/`502`/`503` counts.

### 7 — Dual-agent rows for the same time slot
The same `(service_id, timestamp)` slot sometimes has two rows from `agent-1` and `agent-2`, occasionally disagreeing on status code or latency. Policy:

- **Storage**: both raw rows are always stored. The `UNIQUE(service_id, ts_utc, agent)` constraint prevents exact duplicates within the same agent but allows two different agents on the same slot.
- **SLA resolution (pessimistic)**: if _either_ agent reports non-2xx for a slot, the slot is counted as DOWN. In code this is `slot.isDown ||= (check.status_code !== 200)`. The alternative — requiring both agents to report failure — would be more permissive and could hide real outages. The pessimistic policy matches the ground truth in `dataset_incident_log.json`.
- **Why not `MIN(status_code)` in SQL?** `MIN(200, 500) = 200` — it would always pick the healthy reading, the opposite of what we want. `MAX(CASE WHEN status_code != 200 THEN 1 ELSE 0 END) = 1` is the correct SQL equivalent. We implement this in TypeScript since we're already iterating rows for latency/incident calculations.

### 8 — Exact full-row duplicates
A handful of rows are byte-for-byte identical. Policy: handled at the DB layer via `INSERT OR IGNORE` against the `UNIQUE(service_id, ts_utc, agent)` constraint. Skipped rows are counted from D1's `rows_written` metadata and reported back to the upload UI as `rejected_count`. No application-level dedup step is needed, which keeps the parser stateless.

### 9 — CRLF line endings
Some files use Windows-style `\r\n`, others use Unix `\n`. The parser normalises both with `text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')` before splitting — the two-pass approach handles lone `\r` (old Mac line endings) as well.

---

## Assumptions

**Incident definition** — a consecutive run of 15-minute slots where at least one agent reported non-2xx (including 999). Duration = slot count × 15 minutes. A single up slot between two down runs starts a new incident. This definition matches the slot structure in `dataset_incident_log.json`.

**4xx codes absent** — zero 4xx codes appear in this dataset. If they did, I would exclude them from the "down" calculation: a `4xx` response means the client made a bad request, not that the service is unavailable. The code is written to count only non-200 codes as down; if 4xx codes appeared they would currently be counted as failures. This is noted as a known gap.

**Latency NULL policy** — blank and negative latency values are stored as `NULL` and excluded from p50/p95 calculations. Imputing a value (zero, mean, etc.) would produce misleading percentiles.

**999 = probe failure** — the monitoring agent emits 999 on timeout/connection failure. It is not a valid HTTP status. Stored as-is; rendered in a visually distinct amber "Probe Failures" row separate from real HTTP error codes.

**Dual-agent SLA: pessimistic** — if either agent reports failure, the slot is down. Chosen because: (a) the incident ground truth uses this policy, and (b) for billing credit purposes, a conservative measurement is preferable — you'd rather grant a credit on ambiguous data than deny a legitimate one.

**Pagination: offset-based** — the largest file has ~15.5 k rows. LIMIT/OFFSET on D1 handles this trivially. Cursor-based pagination would be more performant at millions of rows, but adds complexity not warranted here.

**Single region, single tenant** — all data is in `ap-south-1`. No per-region or per-account isolation is implemented.

---

## CPU Time Benchmark

> **Required by the assignment spec**: upload `monitoring_checks_30d_seed404.csv` (15,577 rows, 1.1 MB) and verify against the Cloudflare Workers free-tier 10 ms CPU limit.

**Measurement (local, Windows / Node 20.17)**:

| Step | Time |
|---|---|
| CRLF regex normalisation | ~4 ms |
| `split('\n')` | ~2 ms |
| Field parse loop (15 k × `split(',')`) | ~17 ms |
| **Total parse-only CPU** | **~20 ms** |
| D1 batch inserts (157 batches × ~127 ms each) | ~20 s wall-clock |

The D1 I/O time (~20 s) is **not counted against the 10 ms CPU budget** — Cloudflare explicitly excludes I/O wait from CPU time measurement.

The ~20 ms parse-only figure was measured on a Windows laptop running Node.js. Cloudflare's V8 isolates run on Linux with a JIT-optimised engine and will be materially faster — the exact on-edge CPU time can only be confirmed after the first real deploy (check the `CF-Ray` response header timing or Cloudflare Workers analytics).

If the parse step turns out to exceed 10 ms on the free tier, the upgrade paths are:
1. **Paid Workers** ($5/month) — raises the CPU limit to 30 ms per request.
2. **Streaming parse** — split the CSV into chunks in the client and send multiple smaller `POST /api/upload` requests, each under budget.

---

## Deploy

### Prerequisites
- A Cloudflare account (free, no credit card required)
- Node.js ≥ 18
- `npm install` already run at the repo root

### Step 1 — Create the D1 database
```bash
npx wrangler d1 create sla-monitor
```
Copy the returned `database_id` and update `wrangler.toml`:
```toml
[[d1_databases]]
binding = "DB"
database_name = "sla-monitor"
database_id = "PASTE_YOUR_ID_HERE"
```

### Step 2 — Apply migrations to production D1
```bash
npx wrangler d1 migrations apply sla-monitor
```

### Step 3 — Deploy the Worker
```bash
npx wrangler deploy
```
Note the returned Worker URL, e.g. `https://sla-monitor.<your-subdomain>.workers.dev`

### Step 4 — Set the production Worker URL in the frontend
Edit `frontend/.env.production`:
```
VITE_WORKER_URL=https://sla-monitor.<your-subdomain>.workers.dev
```

### Step 5 — Build and deploy the frontend
```bash
cd frontend
npm run build
npx wrangler pages deploy dist --project-name sla-dashboard
```
Note the returned Pages URL, e.g. `https://sla-dashboard.pages.dev`

### Step 6 — Update the live URL in this README
Replace the placeholder at the top of this file with the Pages URL from Step 5.

### Redeploy (after code changes)

Worker only:
```bash
npx wrangler deploy
```

Frontend only:
```bash
cd frontend && npm run build
npx wrangler pages deploy dist --project-name sla-dashboard
```

Both (full redeploy):
```bash
npx wrangler deploy
cd frontend && npm run build && npx wrangler pages deploy dist --project-name sla-dashboard
```

### Run locally
```bash
# Terminal 1 — Worker + D1 local simulation
npx wrangler dev

# Terminal 2 — Vite frontend dev server
cd frontend && npm run dev
```
The frontend reads `VITE_WORKER_URL=http://localhost:8787` from `frontend/.env.development`.

Apply the migration to the local D1 first if you haven't already:
```bash
npx wrangler d1 migrations apply sla-monitor --local
```

### Re-seed local D1 (wipe and reload)
```bash
# Wipe the local state
Remove-Item -Recurse -Force .wrangler/state/v3/d1

# Re-apply migrations
npx wrangler d1 migrations apply sla-monitor --local

# Upload a CSV (with wrangler dev running)
curl -F "file=@monitoring_checks_9d_seed101.csv" http://localhost:8787/api/upload
```

---

## Running tests
```bash
# Worker unit tests (parser + stats logic)
npm test

# Frontend TypeScript check + production build
cd frontend && npm run build
```

---

## What I'd Improve With More Time

1. **Cursor-based pagination** — offset pagination degrades at high page numbers (SQLite must scan and skip). Cursor-based (keyed on `id`) would scale linearly. Not needed for this dataset but worth noting.

2. **Latency time-series chart** — a line chart of p50/p95 latency over the selected date range per service would make degradations visible at a glance. Recharts or Chart.js would drop in cleanly.

3. **Re-upload / dedup UX** — currently re-uploading the same file silently skips duplicates via `INSERT OR IGNORE`. It would be better to detect the re-upload (by filename + row count match in the `uploads` table) and give the user an explicit "already ingested — skip or replace?" prompt.

4. **Rate limiting on POST /api/upload** — the upload endpoint does significant CPU work (CSV parsing) and up to 157 D1 batch calls per request. Cloudflare Rate Limiting (free up to 100 k requests/month) would prevent abuse.

5. **Streaming CSV parse** — if files grow beyond ~5 MB, the current approach (load entire file into a string, then parse) could hit the Worker's 128 MB memory limit. A streaming line-by-line parser would remove that ceiling and also bring parse CPU below the 10 ms free-tier budget for any file size.

6. **Schema evolution** — adding columns to the `checks` table requires a new migration file. A lightweight migration runner (or just careful use of `ALTER TABLE`) would make future schema changes safe.

7. **Timezone-aware date filtering** — the DateFilter UI converts local date strings to UTC midnight boundaries (`T00:00:00.000Z`). If the user's browser is not in UTC, a date like "2025-05-13" maps to UTC midnight, which may not match their intuition. A timezone selector or explicit UTC-only note in the UI would remove this ambiguity.
