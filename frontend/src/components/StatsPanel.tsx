import { useState } from "react";
import type { StatsResult } from "../api";
import ServiceCard from "./ServiceCard";
import LatencyChart from "./LatencyChart";

interface Props {
  stats: StatsResult | null;
  loading: boolean;
}

function SkeletonCard() {
  return (
    <div className="rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 p-5 space-y-4 animate-pulse">
      <div className="flex justify-between items-center">
        <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-1/3" />
        <div className="h-5 bg-slate-200 dark:bg-slate-800 rounded-full w-14" />
      </div>
      <div className="space-y-2">
        <div className="h-2 bg-slate-200 dark:bg-slate-800 rounded w-full" />
        <div className="h-3 bg-slate-100 dark:bg-slate-800/60 rounded w-1/2" />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="h-12 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/60 rounded-lg" />
        <div className="h-12 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/60 rounded-lg" />
      </div>
    </div>
  );
}

export default function StatsPanel({ stats, loading }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const overall = stats?.overall;
  const incidentTotal =
    stats?.services.reduce((s, svc) => s + svc.incident_count, 0) ?? 0;

  return (
    <section className="space-y-6">
      {/* Overview KPI Strip Card */}
      <div className="rounded-2xl bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 shadow-xl shadow-slate-200/50 dark:shadow-black/20 overflow-hidden backdrop-blur-sm transition-colors duration-200">
        <div className="px-5 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800/80">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight uppercase text-[12px]">
              System Health Overview
            </h2>
            {overall?.from_ts && (
              <span className="hidden sm:inline-block px-2.5 py-0.5 rounded-full text-[11px] font-mono text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                {new Date(overall.from_ts).toLocaleDateString("en-GB", { timeZone: "UTC" })}
                {" → "}
                {new Date(overall.to_ts!).toLocaleDateString("en-GB", { timeZone: "UTC" })} UTC
              </span>
            )}
            {loading && (
              <span className="text-xs text-indigo-600 dark:text-indigo-400 font-medium animate-pulse flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />
                Syncing…
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 bg-slate-100 dark:bg-slate-800/60 hover:bg-slate-200 dark:hover:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700/60 transition-colors"
            aria-expanded={!collapsed}
          >
            {collapsed ? "Show stats ▼" : "Hide stats ▲"}
          </button>
        </div>

        {!collapsed && overall && (
          <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 divide-x-0 sm:divide-x divide-slate-200 dark:divide-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
            <Kpi
              value={`${overall.uptime_pct.toFixed(3)}%`}
              label="Fleet Average Uptime"
              sublabel="Across all monitored microservices"
              accent={overall.sla_compliant ? "ok" : "bad"}
            />
            <Kpi
              value={`${stats!.services.length - overall.non_compliant_services.length}/${stats!.services.length}`}
              label="Monthly SLA Compliant"
              sublabel={overall.non_compliant_services.length === 0 ? "Calendar-month 99.9% met" : "Monthly breaches detected"}
              accent={overall.non_compliant_services.length === 0 ? "ok" : "bad"}
            />
            <Kpi
              value={overall.total_checks.toLocaleString()}
              label="Total Agent Probes"
              sublabel="Multi-agent health validations"
            />
            <Kpi
              value={String(incidentTotal)}
              label="Total Outage Incidents"
              sublabel="Labeled windows from the seed incident log"
              accent={incidentTotal === 0 ? "ok" : "warn"}
            />
          </div>
        )}
      </div>

      {/* Per-Service Health Section */}
      {!collapsed && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-400 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-500 dark:bg-indigo-400" />
              Per-Service SLA &amp; Telemetry Cards ({stats?.services.length ?? 0})
            </h3>
            <span className="text-[11px] text-slate-500 font-medium">SLA Target: 99.900%</span>
          </div>

          {stats && stats.services.length > 0 && <LatencyChart services={stats.services} />}

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5">
              {[...Array(5)].map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : stats && stats.services.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5">
              {stats.services
                .sort((a, b) => a.service_id.localeCompare(b.service_id))
                .map((svc) => (
                  <ServiceCard key={svc.service_id} stats={svc} />
                ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-800 bg-white/50 dark:bg-slate-900/30 py-12 text-center">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">No telemetry data found</p>
              <p className="text-xs text-slate-500 mt-1">Upload a monitoring CSV to populate dashboard statistics.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Kpi({
  value,
  label,
  sublabel,
  accent,
}: {
  value: string;
  label: string;
  sublabel?: string;
  accent?: "ok" | "bad" | "warn";
}) {
  const valueColor =
    accent === "ok"
      ? "text-emerald-600 dark:text-emerald-400"
      : accent === "bad"
        ? "text-rose-600 dark:text-rose-400"
        : accent === "warn"
          ? "text-amber-600 dark:text-amber-400"
          : "text-slate-900 dark:text-white";

  return (
    <div className="p-5 sm:p-6 space-y-1">
      <p className={`text-2xl sm:text-3xl font-extrabold font-mono tabular-nums tracking-tight ${valueColor}`}>
        {value}
      </p>
      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{label}</p>
      {sublabel && <p className="text-[11px] text-slate-500 truncate">{sublabel}</p>}
    </div>
  );
}
