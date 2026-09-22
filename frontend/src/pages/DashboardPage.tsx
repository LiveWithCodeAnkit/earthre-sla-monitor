import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchStats, type StatsResult } from "../api";
import StatsPanel from "../components/StatsPanel";
import DateFilter, { type FilterValues } from "../components/DateFilter";
import LogsTable from "../components/LogsTable";

// The 5 known service IDs — used to populate the service dropdown.
// These are discovered from data at runtime and fall back to this static list
// so the filter works even before any upload on a fresh session.
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

  // Shared filter state — drives both the stats panel and the logs table
  const [filters, setFilters] = useState<FilterValues>({});

  // Derive service list from loaded stats (or fall back to KNOWN_SERVICES)
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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top nav */}
      <nav className="bg-white border-b border-gray-200 px-4 sm:px-6 py-3 flex items-center justify-between">
        <h1 className="font-bold text-gray-900">SLA Monitor</h1>
        <Link
          to="/upload"
          className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
        >
          ← Upload CSV
        </Link>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4">

        {/* Filters — shared between stats panel and logs table */}
        <DateFilter
          services={serviceIds}
          onChange={setFilters}
        />

        {/* Stats error */}
        {statsError && !statsLoading && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">
            Stats unavailable: {statsError}
          </div>
        )}

        {/* Collapsible stats panel */}
        <StatsPanel stats={stats} loading={statsLoading} />

        {/* Logs table — uses same filters */}
        <LogsTable filters={filters} />

      </div>
    </div>
  );
}
