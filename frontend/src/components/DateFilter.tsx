import { useEffect, useRef, useState } from "react";

export interface FilterValues {
  from?: string;
  to?: string;
  service?: string;
}

interface Props {
  services?: string[];
  onChange: (v: FilterValues) => void;
  initialValues?: FilterValues;
}

const inputClass =
  "h-8 rounded-lg border border-slate-300 dark:border-slate-700/80 bg-white dark:bg-slate-900/90 px-2.5 text-xs text-slate-800 dark:text-slate-200 " +
  "hover:border-slate-400 dark:hover:border-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 " +
  "transition-all shadow-sm";

/** Compact toolbar filters — auto-apply on change, dark & light unified shell chrome. */
export default function DateFilter({ services, onChange, initialValues }: Props) {
  const [mode, setMode] = useState<"single" | "range">("single");
  const [date, setDate] = useState(initialValues?.from?.slice(0, 10) ?? "");
  const [from, setFrom] = useState(initialValues?.from?.slice(0, 10) ?? "");
  const [to, setTo] = useState(initialValues?.to?.slice(0, 10) ?? "");
  const [service, setService] = useState(initialValues?.service ?? "");

  const isFirst = useRef(true);
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }

    const v: FilterValues = {};
    if (service) v.service = service;
    if (mode === "single" && date) {
      v.from = `${date}T00:00:00.000Z`;
      v.to = `${date}T23:59:59.999Z`;
    } else if (mode === "range") {
      if (from) v.from = `${from}T00:00:00.000Z`;
      if (to) v.to = `${to}T23:59:59.999Z`;
    }
    onChange(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, date, from, to, service]);

  function reset() {
    setDate("");
    setFrom("");
    setTo("");
    setService("");
    onChange({});
  }

  const hasActive = Boolean(date || from || to || service);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
      {/* Mode Switcher Pill */}
      <div className="inline-flex h-8 rounded-lg bg-slate-200/80 dark:bg-slate-950/80 border border-slate-300 dark:border-slate-800 p-0.5 text-xs font-medium">
        <button
          type="button"
          onClick={() => setMode("single")}
          className={`px-3 py-1 rounded-md transition-all duration-150 ${
            mode === "single"
              ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold shadow-sm"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
          }`}
        >
          Single Date
        </button>
        <button
          type="button"
          onClick={() => setMode("range")}
          className={`px-3 py-1 rounded-md transition-all duration-150 ${
            mode === "range"
              ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold shadow-sm"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
          }`}
        >
          Date Range
        </button>
      </div>

      {/* Date Pickers */}
      {mode === "single" ? (
        <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
          <span className="font-medium text-slate-600 dark:text-slate-400">Date (UTC):</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        </label>
      ) : (
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
            <span className="font-medium text-slate-600 dark:text-slate-400">From:</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
            <span className="font-medium text-slate-600 dark:text-slate-400">To:</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
          </label>
        </div>
      )}

      {/* Service Dropdown */}
      {services && services.length > 0 && (
        <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
          <span className="font-medium text-slate-600 dark:text-slate-400">Service:</span>
          <select
            value={service}
            onChange={(e) => setService(e.target.value)}
            className={`${inputClass} cursor-pointer min-w-[130px]`}
          >
            <option value="">All Services</option>
            {services.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Clear Filters CTA */}
      {hasActive && (
        <button
          type="button"
          onClick={reset}
          className="text-xs font-semibold text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 px-2 py-1 rounded hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors"
        >
          ✕ Reset Filters
        </button>
      )}

      <span className="text-[11px] text-slate-500 ml-auto hidden lg:inline font-mono">
        Auto-applied query
      </span>
    </div>
  );
}
