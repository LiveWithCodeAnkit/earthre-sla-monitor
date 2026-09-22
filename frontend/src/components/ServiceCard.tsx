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

function formatRelativeTime(isoTs: string | null): string {
  if (!isoTs) return "—";
  const diff = Date.now() - new Date(isoTs).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatTs(isoTs: string): string {
  return new Date(isoTs).toLocaleString("en-GB", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    timeZone: "UTC", timeZoneName: "short",
  });
}

export default function ServiceCard({ stats }: Props) {
  const compliant = stats.sla_compliant;

  // Separate 999 (probe failures) from real HTTP error codes
  const probeFailures = stats.error_breakdown["999"] ?? 0;
  const httpErrors = Object.entries(stats.error_breakdown)
    .filter(([code]) => code !== "999")
    .sort(([a], [b]) => Number(a) - Number(b));

  return (
    <div className={`bg-white rounded-xl border shadow-sm p-5 space-y-4
      ${compliant ? "border-green-200" : "border-red-200"}`}>

      {/* Header row */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-gray-900">{stats.service_name}</h3>
          <p className="text-xs text-gray-400 font-mono">{stats.service_id}</p>
        </div>
        <span className={`text-xs font-semibold px-2 py-1 rounded-full
          ${compliant ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
          {compliant ? "✓ SLA Met" : "✗ SLA Breach"}
        </span>
      </div>

      {/* Uptime */}
      <div>
        <div className="flex justify-between text-sm mb-1">
          <span className="text-gray-600">Uptime</span>
          <span className={`font-bold ${compliant ? "text-green-600" : "text-red-600"}`}>
            {stats.uptime_pct.toFixed(3)}%
          </span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${compliant ? "bg-green-500" : "bg-red-500"}`}
            style={{ width: `${Math.min(100, stats.uptime_pct)}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-400 mt-0.5">
          <span>{stats.total_slots} slots checked</span>
          <span>{stats.sla_slots_down} down</span>
        </div>
      </div>

      {/* Latency */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <p className="text-lg font-semibold text-gray-800">
            {stats.p50_latency_ms !== null ? `${stats.p50_latency_ms}ms` : "—"}
          </p>
          <p className="text-xs text-gray-500">p50 latency</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <p className="text-lg font-semibold text-gray-800">
            {stats.p95_latency_ms !== null ? `${stats.p95_latency_ms}ms` : "—"}
          </p>
          <p className="text-xs text-gray-500">p95 latency</p>
        </div>
      </div>

      {/* Error breakdown */}
      {(httpErrors.length > 0 || probeFailures > 0) && (
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            Error breakdown
          </p>
          <table className="w-full text-sm">
            <tbody>
              {httpErrors.map(([code, count]) => (
                <tr key={code} className="border-t border-gray-100">
                  <td className="py-1 pr-2">
                    <span className="font-mono text-red-600 font-semibold">{code}</span>
                    <span className="text-gray-500 text-xs ml-1">
                      {code === "500" ? "Internal Server Error"
                       : code === "502" ? "Bad Gateway"
                       : code === "503" ? "Service Unavailable"
                       : "HTTP Error"}
                    </span>
                  </td>
                  <td className="py-1 text-right text-gray-700 font-medium">{count}</td>
                </tr>
              ))}
              {/* 999 probe failures — visually distinct, never merged with 5xx */}
              {probeFailures > 0 && (
                <tr className="border-t border-amber-100 bg-amber-50">
                  <td className="py-1 pr-2 pl-1 rounded-l">
                    <span className="font-mono text-amber-700 font-semibold">999</span>
                    <span className="text-amber-600 text-xs ml-1">Probe Failure / Timeout</span>
                  </td>
                  <td className="py-1 text-right text-amber-700 font-medium pr-1 rounded-r">
                    {probeFailures}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Incidents */}
      <div>
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
          Incidents
        </p>
        {stats.incident_count === 0 ? (
          <p className="text-sm text-green-600">No incidents in range</p>
        ) : (
          <div className="space-y-1">
            <p className="text-sm text-red-600 font-medium">
              {stats.incident_count} incident{stats.incident_count !== 1 ? "s" : ""}
              {" · "}
              {formatDuration(stats.incidents.reduce((s, i) => s + i.duration_min, 0))} total downtime
            </p>
            {/* Show up to 5 most-recent incidents */}
            <div className="space-y-0.5 max-h-28 overflow-y-auto">
              {[...stats.incidents]
                .sort((a, b) => b.start.localeCompare(a.start))
                .slice(0, 5)
                .map((inc: Incident, i) => (
                  <div key={i} className="text-xs text-gray-600 font-mono">
                    {formatTs(inc.start)} → {formatTs(inc.end)}
                    <span className="ml-1 text-red-500">({formatDuration(inc.duration_min)})</span>
                  </div>
                ))}
              {stats.incident_count > 5 && (
                <p className="text-xs text-gray-400">
                  …and {stats.incident_count - 5} more
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Last check freshness */}
      <div className="border-t border-gray-100 pt-3 flex justify-between text-xs text-gray-400">
        <span>Last check</span>
        <span title={stats.last_check_ts ?? ""}>
          {formatRelativeTime(stats.last_check_ts)}
        </span>
      </div>
    </div>
  );
}
