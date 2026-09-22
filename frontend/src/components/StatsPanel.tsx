import { useState } from "react";
import type { StatsResult } from "../api";
import ServiceCard from "./ServiceCard";

interface Props {
  stats: StatsResult | null;
  loading: boolean;
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4 animate-pulse">
      <div className="flex justify-between">
        <div className="space-y-1">
          <div className="h-4 bg-gray-200 rounded w-28" />
          <div className="h-3 bg-gray-100 rounded w-20" />
        </div>
        <div className="h-6 bg-gray-200 rounded-full w-20" />
      </div>
      <div className="h-2 bg-gray-200 rounded-full w-full" />
      <div className="grid grid-cols-2 gap-3">
        <div className="h-14 bg-gray-100 rounded-lg" />
        <div className="h-14 bg-gray-100 rounded-lg" />
      </div>
    </div>
  );
}

export default function StatsPanel({ stats, loading }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const overall = stats?.overall;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-4">
      {/* Panel header — always visible */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors rounded-xl"
        aria-expanded={!collapsed}
      >
        <div className="flex items-center gap-3">
          <span className="font-semibold text-gray-900">SLA Statistics</span>

          {/* Overall summary chips — visible even when collapsed */}
          {overall && (
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium
                ${overall.sla_compliant ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                {overall.uptime_pct.toFixed(2)}% overall uptime
              </span>
              {overall.non_compliant_services.length > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700">
                  {overall.non_compliant_services.length} service{overall.non_compliant_services.length !== 1 ? "s" : ""} breaching SLA
                </span>
              )}
              {overall.from_ts && (
                <span className="text-xs text-gray-400 hidden sm:inline">
                  {new Date(overall.from_ts).toLocaleDateString("en-GB", { timeZone: "UTC" })}
                  {" – "}
                  {new Date(overall.to_ts!).toLocaleDateString("en-GB", { timeZone: "UTC" })}
                </span>
              )}
            </div>
          )}

          {loading && (
            <span className="text-xs text-gray-400 animate-pulse">Loading…</span>
          )}
        </div>

        <span className="text-gray-400 text-lg select-none" aria-hidden>
          {collapsed ? "▶" : "▼"}
        </span>
      </button>

      {/* Collapsible body */}
      {!collapsed && (
        <div className="px-5 pb-5 border-t border-gray-100">
          {/* Overall summary bar */}
          {overall && (
            <div className="mt-4 mb-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-gray-800">{overall.uptime_pct.toFixed(2)}%</p>
                <p className="text-xs text-gray-500">Avg uptime</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className={`text-xl font-bold ${overall.non_compliant_services.length === 0 ? "text-green-600" : "text-red-600"}`}>
                  {stats!.services.length - overall.non_compliant_services.length} / {stats!.services.length}
                </p>
                <p className="text-xs text-gray-500">SLA-compliant services</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-gray-800">
                  {overall.total_checks.toLocaleString()}
                </p>
                <p className="text-xs text-gray-500">Total checks</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-gray-800">
                  {stats!.services.reduce((s, svc) => s + svc.incident_count, 0)}
                </p>
                <p className="text-xs text-gray-500">Total incidents</p>
              </div>
            </div>
          )}

          {/* Per-service cards */}
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(5)].map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : stats && stats.services.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {stats.services
                .sort((a, b) => a.service_id.localeCompare(b.service_id))
                .map((svc) => (
                  <ServiceCard key={svc.service_id} stats={svc} />
                ))}
            </div>
          ) : !loading && (
            <p className="text-gray-400 text-sm py-4 text-center">
              No data yet — upload a CSV to see stats.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
