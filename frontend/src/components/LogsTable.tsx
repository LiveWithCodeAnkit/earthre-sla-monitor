import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchLogs, type LogRow, type LogsResult } from "../api";
import type { FilterValues } from "./DateFilter";

interface Props {
  filters: FilterValues;
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------
function StatusBadge({ code }: { code: number }) {
  if (code === 200) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold bg-green-100 text-green-700">
        {code}
      </span>
    );
  }
  if (code === 999) {
    // 999 is a probe failure / timeout sentinel — amber, distinct from 5xx
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold bg-amber-100 text-amber-700">
        {code} <span className="ml-1 font-normal">probe</span>
      </span>
    );
  }
  // Real 5xx errors
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold bg-red-100 text-red-700">
      {code}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Timestamp formatter (UTC)
// ---------------------------------------------------------------------------
function formatTs(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
    timeZone: "UTC", timeZoneName: "short",
  });
}

// ---------------------------------------------------------------------------
// Skeleton row
// ---------------------------------------------------------------------------
function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      {[...Array(6)].map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-3 bg-gray-200 rounded w-full" />
        </td>
      ))}
    </tr>
  );
}

// ---------------------------------------------------------------------------
// LogsTable
// ---------------------------------------------------------------------------
export default function LogsTable({ filters }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Derive initial page from URL query params — supports browser back/forward
  const [page, setPage] = useState(() => {
    const p = parseInt(searchParams.get("page") ?? "1", 10);
    return isNaN(p) || p < 1 ? 1 : p;
  });

  const [data, setData] = useState<LogsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reset to page 1 whenever filters change
  useEffect(() => {
    setPage(1);
  }, [filters.from, filters.to, filters.service]);

  // Fetch whenever page or filters change
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchLogs({
      service: filters.service,
      from: filters.from,
      to: filters.to,
      page,
    })
      .then((result) => { if (!cancelled) setData(result); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load logs"); })
      .finally(() => { if (!cancelled) setLoading(false); });

    // Sync page to URL so browser back button restores position
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("page", String(page));
      if (filters.service) next.set("service", filters.service);
      else next.delete("service");
      return next;
    }, { replace: true });

    return () => { cancelled = true; };
  }, [page, filters.from, filters.to, filters.service]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      {/* Table header */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">Check Logs</h2>
        {data && (
          <span className="text-xs text-gray-400">
            {data.total.toLocaleString()} total rows
          </span>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className="px-5 py-4 text-red-600 text-sm">{error}</div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Timestamp (UTC)</th>
              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Service</th>
              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Latency</th>
              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Agent</th>
              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Region</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading
              ? [...Array(10)].map((_, i) => <SkeletonRow key={i} />)
              : data?.rows.length === 0
              ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400 text-sm">
                    No logs match the current filters.
                  </td>
                </tr>
              )
              : data?.rows.map((row: LogRow) => (
                <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-2.5 text-gray-600 text-xs whitespace-nowrap font-mono">
                    {formatTs(row.ts_utc)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-gray-800 font-medium">{row.service_name}</span>
                    <span className="block text-xs text-gray-400 font-mono">{row.service_id}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge code={row.status_code} />
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-600 tabular-nums whitespace-nowrap">
                    {row.latency_ms !== null
                      ? <>{row.latency_ms.toLocaleString()}<span className="text-gray-400 text-xs ml-0.5">ms</span></>
                      : <span className="text-gray-300">—</span>
                    }
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 font-mono text-xs">{row.agent}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{row.region}</td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>

      {/* Pagination footer */}
      <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1 || loading}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md
            disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
        >
          ← Previous
        </button>

        <span className="text-sm text-gray-500">
          Page <span className="font-medium text-gray-800">{page}</span> of{" "}
          <span className="font-medium text-gray-800">{totalPages}</span>
        </span>

        <button
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page >= totalPages || loading}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md
            disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
