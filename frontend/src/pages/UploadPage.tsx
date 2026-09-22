import { useState } from "react";
import { Link } from "react-router-dom";
import AppShell from "../components/AppShell";
import UploadForm from "../components/UploadForm";
import { uploadCSV, type UploadResult } from "../api";

export default function UploadPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showReasons, setShowReasons] = useState(false);

  async function handleUpload(file: File) {
    setLoading(true);
    setResult(null);
    setError(null);
    setShowReasons(false);
    try {
      const r = await uploadCSV(file);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell>
      <main className="flex-1 flex items-start sm:items-center justify-center px-4 py-8 sm:py-12">
        <div className="w-full max-w-xl space-y-6">
          {/* Header Title & Subtitle */}
          <div className="text-center space-y-2">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              Ingest Monitoring Logs
            </h2>
            <p className="text-slate-600 dark:text-slate-400 text-sm max-w-md mx-auto leading-relaxed">
              Upload raw multi-agent health-check CSV files. Our stateless serverless pipeline parses,
              cleans DQ anomalies, and validates all rows into Cloudflare D1.
            </p>
          </div>

          {/* Ingestion Card Wrapper */}
          <div className="rounded-2xl bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 shadow-xl shadow-slate-200/50 dark:shadow-black/30 p-6 sm:p-8 space-y-6 backdrop-blur-sm transition-colors duration-200">
            <UploadForm onUpload={handleUpload} loading={loading} />

            {/* Server Error Message */}
            {error && (
              <div
                role="alert"
                className="rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 p-4 space-y-1"
              >
                <div className="flex items-center gap-2 text-rose-700 dark:text-rose-400 font-semibold text-sm">
                  <span>⚠️</span>
                  <span>Upload Failed</span>
                </div>
                <p className="text-rose-600 dark:text-rose-300 text-xs pl-6">{error}</p>
              </div>
            )}

            {/* Successful Ingestion Result */}
            {result && (
              <div className="rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 p-5 space-y-4">
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 w-5 h-5 rounded-full bg-emerald-600 dark:bg-emerald-500 text-white dark:text-slate-950 flex items-center justify-center font-bold text-xs shrink-0">
                    ✓
                  </span>
                  <div className="min-w-0">
                    <p className="text-emerald-900 dark:text-emerald-300 font-bold text-sm">Ingestion Complete</p>
                    <p className="text-emerald-700 dark:text-emerald-400/80 text-xs font-mono truncate mt-0.5">
                      {result.filename}
                    </p>
                  </div>
                </div>

                {/* Metric Strip */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white dark:bg-slate-950/80 rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 text-center shadow-sm">
                    <p className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 font-mono tabular-nums">
                      {result.row_count.toLocaleString()}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Rows Inserted</p>
                  </div>
                  <div className="bg-white dark:bg-slate-950/80 rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 text-center shadow-sm">
                    <p
                      className={`text-2xl font-extrabold font-mono tabular-nums ${
                        result.rejected_count > 0 ? "text-amber-600 dark:text-amber-400" : "text-slate-400 dark:text-slate-500"
                      }`}
                    >
                      {result.rejected_count.toLocaleString()}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Rejected / Skipped</p>
                  </div>
                </div>

                {/* Rejection Audit Details */}
                {result.rejected_sample.length > 0 && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setShowReasons(!showReasons)}
                      className="text-xs text-amber-700 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 font-semibold underline underline-offset-2 flex items-center gap-1.5 transition-colors"
                    >
                      <span>{showReasons ? "Hide" : "Show"} DQ rejection reasons &amp; audit notes</span>
                      <span className="text-[10px]">{showReasons ? "▲" : "▼"}</span>
                    </button>
                    {showReasons && (
                      <ul className="mt-2.5 space-y-1.5 max-h-36 overflow-y-auto pr-1">
                        {result.rejected_sample.map((reason, i) => (
                          <li
                            key={i}
                            className="text-[11px] text-amber-900 dark:text-amber-200/90 font-mono bg-amber-50 dark:bg-slate-950/90 border border-amber-200 dark:border-amber-500/20 rounded-lg px-2.5 py-1.5"
                          >
                            {reason}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {/* Direct CTA to Dashboard */}
                <Link
                  to="/dashboard"
                  className="block w-full text-center py-3 px-4 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-all shadow-md shadow-indigo-600/20"
                >
                  Explore Performance Dashboard →
                </Link>
              </div>
            )}
          </div>

          {/* Secondary Helper: Ingestion Requirements card */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/50 p-5 space-y-3 shadow-sm transition-colors duration-200">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-500 dark:bg-indigo-400" />
              <p className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                Ingestion Requirements &amp; Pipeline Specs
              </p>
            </div>
            <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-2 leading-relaxed">
              <li className="flex items-start gap-2">
                <span className="font-semibold text-slate-800 dark:text-slate-200 shrink-0">Accepted Format:</span>
                <span>
                  <span className="font-mono text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 px-1.5 py-0.5 rounded text-[11px]">
                    .csv
                  </span>{" "}
                  files (up to 30 days of multi-agent health checks).
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-semibold text-slate-800 dark:text-slate-200 shrink-0">Required Schema:</span>
                <span className="font-mono text-[11px] text-slate-700 dark:text-slate-300">
                  service_id, service_name, timestamp, status_code, latency, latency_unit, agent, region
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-semibold text-slate-800 dark:text-slate-200 shrink-0">Cleaning Rules:</span>
                <span>
                  Handles 9 DQ defects: timestamp normalization, microsecond units, negative latencies,
                  dual-agent cross-validation, and duplicate suppression.
                </span>
              </li>
            </ul>
          </div>
        </div>
      </main>
    </AppShell>
  );
}
