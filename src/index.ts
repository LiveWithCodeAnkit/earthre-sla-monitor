/**
 * index.ts — Cloudflare Worker entry point.
 *
 * Routes:
 *   POST /api/upload  — parse CSV, clean, write to D1, return stats
 *   GET  /api/logs    — paginated raw check records
 *   GET  /api/stats   — aggregated SLA stats (implemented in Task 5)
 *
 * CORS:
 *   Development: allows http://localhost:5173 (Vite dev server)
 *   Production:  allows the Cloudflare Pages URL (updated in Task 9)
 *   OPTIONS preflight is handled for all routes.
 */

import { parseCSV } from "./parser";
import { insertChecks, insertUpload, queryLogs, queryStats } from "./db";
import type { Env } from "./types";

// ---------------------------------------------------------------------------
// CORS helpers
// ---------------------------------------------------------------------------

/**
 * Returns CORS headers for the given Origin.
 *
 * We restrict to known origins rather than using "*" so that the header is
 * always a single concrete value (required when the browser sends credentials,
 * and also good hygiene even without auth).
 *
 * Allowed origins:
 *   - http://localhost:5173          — Vite dev server
 *   - https://sla-dashboard.pages.dev — Cloudflare Pages production URL
 *   - https://*.sla-dashboard.pages.dev — Cloudflare Pages preview/branch URLs
 *     (each `wrangler pages deploy` push gets a unique subdomain like
 *      https://abc123.sla-dashboard.pages.dev — we match the suffix)
 *
 * DEPLOY NOTE: After running `npx wrangler pages deploy dist --project-name sla-dashboard`
 * for the first time, replace "sla-dashboard" below with your actual Pages
 * project name if you chose a different one.
 *
 * If the origin is not in the allow-list we still return a 200 (the Worker
 * has no session state to protect); the browser enforces CORS on its side.
 */
function getCorsHeaders(origin: string | null): Record<string, string> {
  // Actual Pages hostname from `wrangler pages project create` (may include a suffix).
  const PAGES_PROJECT = "sla-dashboard-55v";

  function isAllowed(o: string): boolean {
    if (o === "http://localhost:5174") return true;
    if (o === `https://${PAGES_PROJECT}.pages.dev`) return true;
    // Cloudflare preview URLs: https://<hash>.<project>.pages.dev
    if (o.endsWith(`.${PAGES_PROJECT}.pages.dev`) && o.startsWith("https://")) return true;
    return false;
  }

  // Fall back to the production Pages URL when origin is absent or not allowed.
  const allowOrigin =
    origin && isAllowed(origin) ? origin : `https://${PAGES_PROJECT}.pages.dev`;

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function json(
  data: unknown,
  status = 200,
  corsHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

// ---------------------------------------------------------------------------
// Worker fetch handler
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const corsHeaders = getCorsHeaders(origin);

    // Handle CORS preflight for all routes.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/upload" && request.method === "POST") {
        // `await` here is intentional: without it, the outer try/catch only
        // catches synchronous errors. Errors thrown inside handleUpload *after*
        // an internal await (e.g. a D1 write failure) would bypass the catch
        // block and surface as a raw runtime 500 rather than our JSON error body.
        return await handleUpload(request, env, corsHeaders);
      }

      if (url.pathname === "/api/logs" && request.method === "GET") {
        return await handleLogs(request, env, corsHeaders);
      }

      if (url.pathname === "/api/stats" && request.method === "GET") {
        return await handleStats(request, env, corsHeaders);
      }

      return json({ error: "Not found" }, 404, corsHeaders);
    } catch (err) {
      // Catch-all: return a 500 with the error message rather than crashing
      // the Worker with an unhandled rejection.
      const message = err instanceof Error ? err.message : "Internal error";
      console.error("Worker unhandled error:", err);
      return json({ error: message }, 500, corsHeaders);
    }
  },
};

// ---------------------------------------------------------------------------
// POST /api/upload
// ---------------------------------------------------------------------------

async function handleUpload(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  // Parse multipart/form-data — the file is expected in the "file" field.
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ error: "Expected multipart/form-data" }, 400, corsHeaders);
  }

  const fileField = formData.get("file");
  if (!fileField || typeof fileField === "string") {
    return json(
      { error: 'Missing "file" field in form data' },
      400,
      corsHeaders
    );
  }

  const file = fileField as File;
  const filename = file.name ?? "unknown.csv";

  // Read file as text. Workers support File.text() natively.
  let text: string;
  try {
    text = await file.text();
  } catch {
    return json({ error: "Could not read uploaded file" }, 400, corsHeaders);
  }

  // --- Parse and clean ---
  // All data quality handling is in parser.ts. The result is:
  //   rows     — CleanRow[] ready for D1 insertion
  //   rejected — rows that failed validation with human-readable reasons
  const { rows, rejected } = parseCSV(text);

  const ingestedAt = new Date().toISOString();

  // --- Write to D1 ---
  // insertChecks uses INSERT OR IGNORE + chunked batch().
  // `skipped` = rows dropped by the UNIQUE constraint (duplicates / re-uploads).
  const { inserted, skipped } = await insertChecks(env.DB, rows, ingestedAt);

  // Total rejected = parse-time rejections + DB-level duplicate skips.
  const totalRejected = rejected.length + skipped;

  // Build a concise rejection summary for the upload response and the
  // uploads.notes audit column. We take the first 5 parse-time reasons
  // plus a summary of DB-level skips.
  const rejectionSample: string[] = [
    ...rejected.slice(0, 5).map((r) => r.reason),
    ...(skipped > 0 ? [`${skipped} duplicate row(s) skipped by DB constraint`] : []),
  ];

  // --- Record the upload batch ---
  await insertUpload(
    env.DB,
    filename,
    ingestedAt,
    inserted,
    totalRejected,
    JSON.stringify(rejectionSample)
  );

  return json(
    {
      filename,
      row_count: inserted,
      rejected_count: totalRejected,
      rejected_sample: rejectionSample,
    },
    200,
    corsHeaders
  );
}

// ---------------------------------------------------------------------------
// GET /api/logs
// ---------------------------------------------------------------------------

async function handleLogs(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const url = new URL(request.url);

  const service = url.searchParams.get("service") ?? undefined;
  const page = parseInt(url.searchParams.get("page") ?? "1", 10);
  const pageSizeRaw = url.searchParams.get("pageSize");
  const pageSize = pageSizeRaw ? parseInt(pageSizeRaw, 10) : undefined;

  // Support both ?date=YYYY-MM-DD (single day) and ?from=...&to=... (range).
  // If both are provided, from/to take precedence over date.
  const dateParam = url.searchParams.get("date");
  const from =
    url.searchParams.get("from") ??
    (dateParam ? `${dateParam}T00:00:00.000Z` : undefined);
  const to =
    url.searchParams.get("to") ??
    (dateParam ? `${dateParam}T23:59:59.999Z` : undefined);

  const result = await queryLogs(env.DB, { service, from, to, page, pageSize });
  return json(result, 200, corsHeaders);
}

// ---------------------------------------------------------------------------
// GET /api/stats
// ---------------------------------------------------------------------------

async function handleStats(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const url = new URL(request.url);

  const service = url.searchParams.get("service") ?? undefined;
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;

  const result = await queryStats(env.DB, { service, from, to });
  return json(result, 200, corsHeaders);
}
