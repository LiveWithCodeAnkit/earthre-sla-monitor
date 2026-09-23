import { useState } from "react";
import type { ServiceStats, Incident } from "../api";

interface Props {
  stats: ServiceStats;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * For timestamps within the last 24 h, returns a human-readable relative string
 * ("just now", "5m ago", "3h ago"). For older timestamps — including historical
 * test fixtures whose data ends months in the past — returns a short absolute
 * UTC date+time string so reviewers never see a misleading "494d ago".
 */
function formatProbeTime(isoTs: string | null): string {
  if (!isoTs) return "—";
  const ts = new Date(isoTs).getTime();
  const diffMs = Date.now() - ts;
  const diffMins = Math.floor(diffMs / 60_000);

  if (diffMins < 2) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  // Data is older than 24 h — show absolute UTC timestamp.
  // This avoids showing "494d ago" for historical datasets.
  return new Date(isoTs).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

function formatTs(isoTs: string): string {
  return new Date(isoTs).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

/** Unified light & dark theme service card with telemetry, SLA compliance, and failure breakdown. */
export default function ServiceCard({ stats }: Props) {
  const compliant = stats.sla_compliant;
  const [open, setOpen] = useState<"failures" | "incidents" | null>(
    compliant ? null : "failures"
  );

  const probeFailures = stats.error_breakdown["999"] ?? 0;
  const httpErrors = Object.entries(stats.error_breakdown)
    .filter(([code]) => code !== "999")
    .sort(([a], [b]) => Number(a) - Number(b));
  const hasFailures = httpErrors.length > 0 || probeFailures > 0;
  const totalFailures = httpErrors.reduce((s, [, c]) => s + c, 0) + probeFailures;
  const downtimeMin = stats.incidents.reduce((s, i) => s + i.duration_min, 0);

  return (
    <article className="rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700/80 p-5 flex flex-col gap-4 shadow-md shadow-slate-200/50 dark:shadow-black/10 transition-all duration-150 backdrop-blur-sm">
      {/* Service Header: Name, ID, SLA Badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                compliant
                  ? "bg-emerald-500 dark:bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.4)]"
                  : "bg-rose-500 dark:bg-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.4)]"
              }`}
              title={
                compliant
                  ? `Monthly SLA 99.9% met (${stats.sla_month ?? "UTC month"})`
                  : `Monthly SLA breached (${stats.sla_month ?? "UTC month"})`
              }
            />
            <h3 className="font-bold text-slate-900 dark:text-white text-sm truncate tracking-tight">
              {stats.service_name}
            </h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5 pl-4.5">{stats.service_id}</p>
        </div>

        <span
          className={`shrink-0 text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
            compliant
              ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30"
              : "bg-rose-50 dark:bg-rose-500/10 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-500/30"
          }`}
        >
          {compliant ? "✓ Monthly 99.9%" : "✕ Monthly breach"}
        </span>
      </div>

      {/* Uptime Metric & Target Progress Bar */}
      <div>
        <div className="flex justify-between items-baseline mb-1.5">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
            Period availability
            {stats.sla_month && (
              <span className="ml-1.5 font-normal text-slate-400">
                · monthly {stats.monthly_uptime_pct.toFixed(3)}%
              </span>
            )}
          </span>
          <span
            className={`text-sm font-extrabold font-mono tabular-nums ${
              compliant ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
            }`}
          >
            {stats.uptime_pct.toFixed(3)}%
          </span>
        </div>
        <div className="h-2 w-full bg-slate-100 dark:bg-slate-950 rounded-full overflow-hidden relative border border-slate-200 dark:border-slate-800/80">
          {/* Target marker at 99.9% */}
          <div
            className="absolute inset-y-0 w-0.5 bg-amber-500 dark:bg-amber-400/80 z-10"
            style={{ left: "99.9%" }}
            title="SLA Target 99.900%"
          />
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              compliant ? "bg-emerald-500" : "bg-rose-500"
            }`}
            style={{ width: `${Math.min(100, Math.max(0, stats.uptime_pct))}%` }}
          />
        </div>
        <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono">
          <span>{stats.total_slots.toLocaleString()} slots checked</span>
          <span className={stats.sla_slots_down > 0 ? "text-rose-600 dark:text-rose-400 font-semibold" : "text-slate-400 dark:text-slate-500"}>
            {stats.sla_slots_down} min downtime
          </span>
        </div>
      </div>

      {/* Latency Telemetry Grid */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 rounded-lg p-2.5">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-0.5">p50 Latency</p>
          <p className="text-sm font-bold font-mono text-slate-900 dark:text-white tabular-nums">
            {stats.p50_latency_ms !== null ? `${stats.p50_latency_ms} ms` : "—"}
          </p>
        </div>
        <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 rounded-lg p-2.5">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-0.5">p95 Latency</p>
          <p className="text-sm font-bold font-mono text-slate-900 dark:text-white tabular-nums">
            {stats.p95_latency_ms !== null ? `${stats.p95_latency_ms} ms` : "—"}
          </p>
        </div>
      </div>

      {/* Collapsible Failure & Incident Sections */}
      <div className="border-t border-slate-200 dark:border-slate-800/80 pt-2 space-y-1">
        {hasFailures && (
          <details
            open={open === "failures"}
            onToggle={(e) => {
              const el = e.currentTarget;
              setOpen(el.open ? "failures" : null);
            }}
            className="group"
          >
            <summary className="cursor-pointer list-none flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300 py-1.5 hover:text-slate-900 dark:hover:text-white transition-colors">
              <span className="flex items-center gap-1.5">
                <span>Failure Breakdown</span>
                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-500/20">
                  {totalFailures}
                </span>
              </span>
              <span className="text-slate-400 dark:text-slate-500 group-open:rotate-180 transition-transform">▾</span>
            </summary>
            <ul className="pb-2 space-y-1.5 text-xs">
              {httpErrors.map(([code, count]) => (
                <li key={code} className="flex justify-between items-center text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/60 rounded px-2 py-1">
                  <span className="flex items-center gap-2">
                    <span className="font-mono font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 px-1 rounded text-[11px]">
                      {code}
                    </span>
                    <span className="text-slate-500 dark:text-slate-400 text-xs">
                      {code === "500"
                        ? "Internal Server Error"
                        : code === "502"
                          ? "Bad Gateway"
                          : code === "503"
                            ? "Service Unavailable"
                            : "HTTP Error"}
                    </span>
                  </span>
                  <span className="font-mono font-semibold text-slate-800 dark:text-slate-200 tabular-nums">{count}</span>
                </li>
              ))}
              {probeFailures > 0 && (
                <li className="flex justify-between items-center text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded px-2 py-1">
                  <span className="flex items-center gap-2">
                    <span className="font-mono font-bold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-500/20 px-1 rounded text-[11px]">
                      999
                    </span>
                    <span className="text-amber-700 dark:text-amber-300/90 text-xs">Probe Timeout (Both Agents)</span>
                  </span>
                  <span className="font-mono font-semibold tabular-nums">{probeFailures}</span>
                </li>
              )}
            </ul>
          </details>
        )}

        <details
          open={open === "incidents"}
          onToggle={(e) => {
            const el = e.currentTarget;
            setOpen(el.open ? "incidents" : null);
          }}
          className="group"
        >
          <summary className="cursor-pointer list-none flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300 py-1.5 hover:text-slate-900 dark:hover:text-white transition-colors">
            <span className="flex items-center gap-1.5">
              <span>Incident History</span>
              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
                {stats.incident_count}
              </span>
              {stats.incident_count > 0 && (
                <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">
                  ({formatDuration(downtimeMin)})
                </span>
              )}
            </span>
            <span className="text-slate-400 dark:text-slate-500 group-open:rotate-180 transition-transform">▾</span>
          </summary>
          <div className="pb-2">
            {stats.incident_count === 0 ? (
              <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium py-1">No recorded downtime incidents in range.</p>
            ) : (
              <ul className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                {[...stats.incidents]
                  .sort((a, b) => b.start.localeCompare(a.start))
                  .slice(0, 5)
                  .map((inc: Incident, i) => (
                    <li
                      key={i}
                      className="text-[11px] font-mono text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/60 rounded px-2 py-1 flex justify-between gap-2 items-center"
                    >
                      <span className="text-slate-500 dark:text-slate-400">{formatTs(inc.start)}</span>
                      <span className="text-rose-600 dark:text-rose-400 font-semibold shrink-0 bg-rose-50 dark:bg-rose-500/10 px-1.5 py-0.5 rounded">
                        {formatDuration(inc.duration_min)}
                      </span>
                    </li>
                  ))}
                {stats.incident_count > 5 && (
                  <li className="text-[11px] text-slate-400 dark:text-slate-500 text-center pt-0.5 font-medium">
                    +{stats.incident_count - 5} additional incidents
                  </li>
                )}
              </ul>
            )}
          </div>
        </details>
      </div>

      {/* Footer Metadata */}
      <div className="flex justify-between items-center text-[11px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-200 dark:border-slate-800/80">
        <span>Latest Telemetry Probe</span>
        <span className="text-slate-700 dark:text-slate-300 font-medium font-mono" title={stats.last_check_ts ?? "No check recorded"}>
          {formatProbeTime(stats.last_check_ts)}
        </span>
      </div>
    </article>
  );
}
