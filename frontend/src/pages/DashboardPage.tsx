import { useEffect, useState } from "react";
import { fetchStats, type StatsResult } from "../api";
import AppShell from "../components/AppShell";
import StatsPanel from "../components/StatsPanel";
import DateFilter, { type FilterValues } from "../components/DateFilter";
import LogsTable from "../components/LogsTable";

const KNOWN_SERVICES = [
  "svc-auth",
  "svc-notify",
  "svc-payments",
  "svc-reports",
  "svc-search",
];

export default function DashboardPage() {
  const [stats, setStats] = useState<StatsResult | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterValues>({});

  const serviceIds =
    stats && stats.services.length > 0
      ? stats.services.map((s) => s.service_id).sort()
      : KNOWN_SERVICES;

  useEffect(() => {
    setStatsLoading(true);
    setStatsError(null);
    fetchStats(filters)
      .then(setStats)
      .catch((e) => setStatsError(e instanceof Error ? e.message : "Failed to load stats"))
      .finally(() => setStatsLoading(false));
  }, [filters]);

  const overallCompliant = stats?.overall.sla_compliant ?? true;

  return (
    <AppShell
      status={
        stats ? (
          <div
            className={`hidden sm:inline-flex items-center gap-2 text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${
              overallCompliant
                ? "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300"
                : "bg-rose-50 dark:bg-rose-500/10 border-rose-300 dark:border-rose-500/30 text-rose-800 dark:text-rose-300"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                overallCompliant
                  ? "bg-emerald-500 dark:bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]"
                  : "bg-rose-500 dark:bg-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.6)]"
              }`}
            />
            <span>{overallCompliant ? "Fleet SLA Compliant" : "Fleet SLA Breach"}</span>
          </div>
        ) : undefined
      }
      toolbar={
        <DateFilter
          services={serviceIds}
          onChange={setFilters}
          dataHint={
            stats?.overall.from_ts && stats.overall.to_ts
              ? `${stats.overall.from_ts.slice(0, 10)} → ${stats.overall.to_ts.slice(0, 10)} UTC in view`
              : undefined
          }
        />
      }
    >
      <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8 space-y-8">
        {/* Error Notification */}
        {statsError && !statsLoading && (
          <div
            role="alert"
            className="rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 p-4 text-sm text-rose-700 dark:text-rose-300 flex items-center gap-2.5"
          >
            <span className="text-lg">⚠️</span>
            <div>
              <span className="font-bold">Stats Pipeline Error:</span> {statsError}
            </div>
          </div>
        )}

        {/* Aggregated KPI Overview & Service Cards */}
        <StatsPanel stats={stats} loading={statsLoading} />

        {/* Paginated Telemetry Log Table */}
        <LogsTable filters={filters} />
      </main>
    </AppShell>
  );
}
