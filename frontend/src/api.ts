// Typed fetch wrappers for all Worker API endpoints.
// VITE_WORKER_URL is set per-environment in .env.development / .env.production
const WORKER_URL = (import.meta.env.VITE_WORKER_URL as string) ?? "http://localhost:8787";

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export interface UploadResult {
  filename: string;
  row_count: number;
  rejected_count: number;
  rejected_sample: string[];
}

export async function uploadCSV(
  file: File,
  opts?: { replace?: boolean }
): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("replace", opts?.replace === false ? "false" : "true");

  const res = await fetch(`${WORKER_URL}/api/upload`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error: string }).error ?? "Upload failed");
  }

  return res.json() as Promise<UploadResult>;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export interface Incident {
  start: string;
  end: string;
  duration_min: number;
}

export interface ServiceStats {
  service_id: string;
  service_name: string;
  total_slots: number;
  sla_slots_down: number;
  uptime_pct: number;
  monthly_uptime_pct: number;
  sla_month: string | null;
  sla_compliant: boolean;
  sla_months: { month: string; uptime_pct: number; compliant: boolean }[];
  error_breakdown: Record<string, number>;
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
    total_checks: number;
    from_ts: string | null;
    to_ts: string | null;
  };
}

export async function fetchStats(params?: {
  service?: string;
  from?: string;
  to?: string;
}): Promise<StatsResult> {
  const url = new URL(`${WORKER_URL}/api/stats`);
  if (params?.service) url.searchParams.set("service", params.service);
  if (params?.from) url.searchParams.set("from", params.from);
  if (params?.to) url.searchParams.set("to", params.to);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Failed to fetch stats");
  return res.json() as Promise<StatsResult>;
}

// ---------------------------------------------------------------------------
// Logs
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

export async function fetchLogs(params: {
  service?: string;
  from?: string;
  to?: string;
  date?: string;
  page?: number;
  pageSize?: number;
}): Promise<LogsResult> {
  const url = new URL(`${WORKER_URL}/api/logs`);
  if (params.service) url.searchParams.set("service", params.service);
  if (params.date) url.searchParams.set("date", params.date);
  if (params.from) url.searchParams.set("from", params.from);
  if (params.to) url.searchParams.set("to", params.to);
  url.searchParams.set("page", String(params.page ?? 1));
  if (params.pageSize) url.searchParams.set("pageSize", String(params.pageSize));

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Failed to fetch logs");
  return res.json() as Promise<LogsResult>;
}
