import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchLogs, type LogRow, type LogsResult } from "../api";
import type { FilterValues } from "./DateFilter";

interface Props {
  filters: FilterValues;
}

function StatusBadge({ code }: { code: number }) {
  if (code === 200) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 shadow-sm">
        {code}
      </span>
    );
  }
  if (code === 999) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30 shadow-sm">
        {code}
        <span className="font-sans font-normal text-[10px] text-amber-700 dark:text-amber-400/80">probe</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-rose-50 dark:bg-rose-500/15 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-500/30 shadow-sm">
      {code}
    </span>
  );
}

function formatTs(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      {[...Array(6)].map((_, i) => (
        <td key={i} className="px-5 py-3.5">
          <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded w-full" />
        </td>
      ))}
    </tr>
  );
}

const PAGE_SIZE_PRESETS = [5, 10, 25, 50, 100] as const;
const MIN_CUSTOM = 5;
const MAX_CUSTOM = 200;

const inputClass =
  "h-8 rounded-lg border border-slate-300 dark:border-slate-700/80 bg-white dark:bg-slate-900/90 px-2.5 text-xs text-slate-800 dark:text-slate-200 " +
  "hover:border-slate-400 dark:hover:border-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 " +
  "transition-all shadow-sm";

export default function LogsTable({ filters }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();

  const [page, setPage] = useState(() => {
    const p = parseInt(searchParams.get("page") ?? "1", 10);
    return isNaN(p) || p < 1 ? 1 : p;
  });

  const [pageSize, setPageSize] = useState(() => {
    const s = parseInt(searchParams.get("pageSize") ?? "25", 10);
    if (isNaN(s) || s < MIN_CUSTOM) return 25;
    return Math.min(MAX_CUSTOM, s);
  });

  const [sizeMode, setSizeMode] = useState<string>(() =>
    (PAGE_SIZE_PRESETS as readonly number[]).includes(pageSize) ? String(pageSize) : "custom"
  );
  const [customInput, setCustomInput] = useState(() =>
    (PAGE_SIZE_PRESETS as readonly number[]).includes(pageSize) ? "" : String(pageSize)
  );
  const [sizeWarning, setSizeWarning] = useState<string | null>(null);

  const [data, setData] = useState<LogsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "ok" | "5xx" | "999">("all");
  const [quickSearch, setQuickSearch] = useState("");

  useEffect(() => {
    setPage(1);
  }, [filters.from, filters.to, filters.service, pageSize]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchLogs({
      service: filters.service,
      from: filters.from,
      to: filters.to,
      page,
      pageSize,
    })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load logs");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("page", String(page));
      next.set("pageSize", String(pageSize));
      if (filters.service) next.set("service", filters.service);
      else next.delete("service");
      return next;
    }, { replace: true });

    return () => {
      cancelled = true;
    };
  }, [page, pageSize, filters.from, filters.to, filters.service]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const skeletonCount = Math.min(pageSize, 12);

  const visibleRows =
    data?.rows.filter((row) => {
      if (statusFilter === "ok" && row.status_code !== 200) return false;
      if (statusFilter === "999" && row.status_code !== 999) return false;
      if (
        statusFilter === "5xx" &&
        (row.status_code < 500 || row.status_code >= 600 || row.status_code === 999)
      )
        return false;
      if (quickSearch.trim()) {
        const q = quickSearch.trim().toLowerCase();
        const hay =
          `${row.service_id} ${row.service_name} ${row.agent} ${row.region} ${row.status_code}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }) ?? [];

  function onSizeModeChange(value: string) {
    setSizeMode(value);
    setSizeWarning(null);
    if (value !== "custom") {
      setPageSize(parseInt(value, 10));
      setCustomInput("");
    }
  }

  function applyCustomSize() {
    const rawVal = customInput.trim();
    const n = parseInt(rawVal, 10);

    if (isNaN(n) || rawVal === "") {
      setSizeWarning("Please enter a valid numeric value between 5 and 200.");
      return;
    }

    if (n > MAX_CUSTOM) {
      setSizeWarning(`Maximum page limit is ${MAX_CUSTOM} rows. Adjusted from ${n} to ${MAX_CUSTOM}.`);
      setCustomInput(String(MAX_CUSTOM));
      setPageSize(MAX_CUSTOM);
      return;
    }

    if (n < MIN_CUSTOM) {
      setSizeWarning(`Minimum page limit is ${MIN_CUSTOM} rows. Adjusted from ${n} to ${MIN_CUSTOM}.`);
      setCustomInput(String(MIN_CUSTOM));
      setPageSize(MIN_CUSTOM);
      return;
    }

    setSizeWarning(null);
    setCustomInput(String(n));
    setPageSize(n);
  }

  const pageBtn =
    "px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700/80 bg-white dark:bg-slate-900/90 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white disabled:opacity-30 disabled:hover:bg-white dark:disabled:hover:bg-slate-900 disabled:hover:text-slate-700 dark:disabled:hover:text-slate-300 disabled:cursor-not-allowed transition-all";

  return (
    <section className="rounded-2xl bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 shadow-xl shadow-slate-200/50 dark:shadow-black/20 overflow-hidden backdrop-blur-sm space-y-0 transition-colors duration-200">
      {/* Table Toolbar Header */}
      <div className="px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-800 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight uppercase text-[12px] flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-500 dark:bg-indigo-400" />
              Health-Check Probe Telemetry Logs
            </h2>
            {data && (
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                <span className="font-semibold text-slate-900 dark:text-slate-200">{data.total.toLocaleString()}</span> logs matching filter criteria
                {visibleRows.length !== data.rows.length && (
                  <span className="text-indigo-600 dark:text-indigo-400 font-medium">
                    {" "}
                    · {visibleRows.length} shown on current page
                  </span>
                )}
              </p>
            )}
          </div>

          {/* Rows Per Page Controls */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="text-slate-600 dark:text-slate-400 font-medium">Page Size:</label>
            <select
              value={sizeMode}
              onChange={(e) => onSizeModeChange(e.target.value)}
              className={`${inputClass} cursor-pointer font-medium`}
            >
              {PAGE_SIZE_PRESETS.map((n) => (
                <option key={n} value={String(n)}>
                  {n} rows
                </option>
              ))}
              <option value="custom">Custom…</option>
            </select>
            {sizeMode === "custom" && (
              <div className="flex items-center gap-1.5">
                <div className="relative">
                  <input
                    type="number"
                    min={MIN_CUSTOM}
                    max={MAX_CUSTOM}
                    placeholder="5–200"
                    value={customInput}
                    onChange={(e) => {
                      setCustomInput(e.target.value);
                      if (sizeWarning) setSizeWarning(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") applyCustomSize();
                    }}
                    className={`${inputClass} w-20 font-mono text-center pr-1`}
                    title="Allowable range: 5 to 200 rows per page"
                  />
                </div>
                <button
                  type="button"
                  onClick={applyCustomSize}
                  className="h-8 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-xs font-semibold shadow-sm transition-all"
                >
                  Apply
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Validation Notice for Custom Page Size */}
        {sizeWarning && (
          <div
            role="alert"
            className="flex items-center justify-between gap-2 text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/30 px-3 py-1.5 rounded-lg transition-all"
          >
            <div className="flex items-center gap-2">
              <span className="font-bold">⚠️ Notice:</span>
              <span>{sizeWarning}</span>
            </div>
            <button
              type="button"
              onClick={() => setSizeWarning(null)}
              className="text-amber-600 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200 text-xs font-bold px-1"
              title="Dismiss notice"
            >
              ✕
            </button>
          </div>
        )}

        {/* Search & Quick Status Filters */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[14rem]">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 text-xs pointer-events-none">
              🔍
            </span>
            <input
              type="search"
              value={quickSearch}
              onChange={(e) => setQuickSearch(e.target.value)}
              placeholder="Search current page by service, region, agent, or status code…"
              className={`${inputClass} w-full pl-8 placeholder:text-slate-400 dark:placeholder:text-slate-500`}
            />
          </div>

          <div className="inline-flex h-8 rounded-lg bg-slate-200/80 dark:bg-slate-950/80 border border-slate-300 dark:border-slate-800 p-0.5 text-xs font-medium">
            {(
              [
                ["all", "All Statuses"],
                ["ok", "200 OK"],
                ["5xx", "5xx Server Error"],
                ["999", "999 Timeout"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setStatusFilter(id)}
                className={`px-3 py-1 rounded-md transition-all duration-150 ${
                  statusFilter === id
                    ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold shadow-sm"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="px-6 py-3.5 text-rose-700 dark:text-rose-300 text-sm bg-rose-50 dark:bg-rose-500/10 border-b border-rose-200 dark:border-rose-500/20 flex items-center gap-2">
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {/* Logs Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-950/80 border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
              <th className="px-5 py-3 whitespace-nowrap">Timestamp (UTC)</th>
              <th className="px-5 py-3">Monitored Service</th>
              <th className="px-5 py-3">Status Code</th>
              <th className="px-5 py-3 text-right">Latency</th>
              <th className="px-5 py-3">Agent</th>
              <th className="px-5 py-3">Region</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
            {loading ? (
              [...Array(skeletonCount)].map((_, i) => <SkeletonRow key={i} />)
            ) : visibleRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-slate-500 dark:text-slate-400 text-sm">
                  <p className="font-semibold text-slate-700 dark:text-slate-300">No log entries matched your filter criteria.</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Try resetting the quick filter or date range.</p>
                </td>
              </tr>
            ) : (
              visibleRows.map((row: LogRow, idx) => (
                <tr
                  key={row.id}
                  className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors ${
                    idx % 2 === 1 ? "bg-slate-50/60 dark:bg-slate-950/30" : "bg-transparent"
                  }`}
                >
                  <td className="px-5 py-3 text-slate-700 dark:text-slate-300 text-xs whitespace-nowrap font-mono">
                    {formatTs(row.ts_utc)}
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-slate-900 dark:text-white text-xs font-semibold block">{row.service_name}</span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                      {row.service_id}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge code={row.status_code} />
                  </td>
                  <td className="px-5 py-3 text-right text-slate-800 dark:text-slate-200 text-xs tabular-nums whitespace-nowrap font-mono">
                    {row.latency_ms !== null ? (
                      <>
                        <span className="font-bold text-slate-900 dark:text-white">{row.latency_ms.toLocaleString()}</span>
                        <span className="text-slate-500 dark:text-slate-400 ml-1">ms</span>
                      </>
                    ) : (
                      <span className="text-slate-400 dark:text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-700 dark:text-slate-300 font-mono text-xs">
                    <span className="bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-2 py-0.5 rounded text-[11px]">
                      {row.agent}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-700 dark:text-slate-300 text-xs font-medium">
                    {row.region}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="px-5 sm:px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50/50 dark:bg-slate-900/50">
        <div className="text-xs text-slate-600 dark:text-slate-400">
          {data && data.total > 0 ? (
            <>
              Showing{" "}
              <span className="font-bold text-slate-900 dark:text-white">
                {((page - 1) * data.pageSize + 1).toLocaleString()}
              </span>
              {" – "}
              <span className="font-bold text-slate-900 dark:text-white">
                {Math.min(page * data.pageSize, data.total).toLocaleString()}
              </span>{" "}
              of{" "}
              <span className="font-bold text-slate-900 dark:text-white">{data.total.toLocaleString()}</span> entries
            </>
          ) : (
            "No log records"
          )}
        </div>

        {/* Page Nav Buttons */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPage(1)}
            disabled={page <= 1 || loading}
            className={pageBtn}
            title="First Page"
          >
            « First
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className={pageBtn}
            title="Previous Page"
          >
            ‹ Prev
          </button>

          {/* Dynamic Page Pill List */}
          <div className="hidden sm:flex items-center gap-1">
            {(() => {
              const pages: (number | string)[] = [];
              const maxVisible = 5;
              let start = Math.max(1, page - Math.floor(maxVisible / 2));
              let end = Math.min(totalPages, start + maxVisible - 1);
              if (end - start + 1 < maxVisible) start = Math.max(1, end - maxVisible + 1);
              if (start > 1) {
                pages.push(1);
                if (start > 2) pages.push("…");
              }
              for (let i = start; i <= end; i++) pages.push(i);
              if (end < totalPages) {
                if (end < totalPages - 1) pages.push("…");
                pages.push(totalPages);
              }
              const uniquePages = pages.filter((p, idx) => pages.indexOf(p) === idx);
              return uniquePages.map((p, idx) =>
                typeof p === "number" ? (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPage(p)}
                    disabled={loading}
                    className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                      page === p
                        ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/30"
                        : "border border-slate-300 dark:border-slate-700/80 bg-white dark:bg-slate-900/90 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
                    }`}
                  >
                    {p}
                  </button>
                ) : (
                  <span key={`ellipsis-${idx}`} className="px-1 text-xs text-slate-400 dark:text-slate-500">
                    {p}
                  </span>
                )
              );
            })()}
          </div>

          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
            className={pageBtn}
            title="Next Page"
          >
            Next ›
          </button>
          <button
            type="button"
            onClick={() => setPage(totalPages)}
            disabled={page >= totalPages || loading}
            className={pageBtn}
            title="Last Page"
          >
            Last »
          </button>
        </div>
      </div>
    </section>
  );
}
