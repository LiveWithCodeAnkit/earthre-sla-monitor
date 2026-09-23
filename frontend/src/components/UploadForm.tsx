import { useRef, useState, type DragEvent, type ChangeEvent, type MouseEvent } from "react";

interface Props {
  onUpload: (file: File, replace: boolean) => void;
  loading: boolean;
}

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB client limit

function isCsvFile(file: File): boolean {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) return true;
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".txt") || name.endsWith(".json")) {
    return false;
  }
  return file.type === "text/csv" || file.type === "application/vnd.ms-excel";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function UploadForm({ onUpload, loading }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(true);

  function acceptFile(file: File | undefined) {
    if (!file) return;
    if (!isCsvFile(file)) {
      setSelectedFile(null);
      setLocalError("Only .csv files are supported. Excel (.xlsx) and plain text are not accepted.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    if (file.size > MAX_BYTES) {
      setSelectedFile(null);
      setLocalError(`File exceeds maximum size limit (${formatSize(file.size)} > ${formatSize(MAX_BYTES)}).`);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    if (file.size === 0) {
      setSelectedFile(null);
      setLocalError("The selected file is empty (0 bytes).");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setLocalError(null);
    setSelectedFile(file);
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    acceptFile(e.target.files?.[0]);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    acceptFile(e.dataTransfer.files?.[0]);
  }

  function clearFile(e?: MouseEvent) {
    e?.stopPropagation();
    setSelectedFile(null);
    setLocalError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleSubmit() {
    if (!selectedFile || loading) return;
    onUpload(selectedFile, replaceExisting);
  }

  return (
    <div className="space-y-4">
      {/* Drop zone / File Preview Box */}
      <div
        onClick={() => !loading && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!loading) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={loading ? undefined : handleDrop}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200 ${
          loading ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
        } ${
          localError
            ? "border-rose-500/50 bg-rose-50 dark:bg-rose-500/5"
            : dragging
              ? "border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-500/10 scale-[1.01]"
              : selectedFile
                ? "border-emerald-500/50 bg-emerald-50/60 dark:bg-emerald-500/5"
                : "border-slate-300 dark:border-slate-700/80 bg-slate-50/70 dark:bg-slate-900/40 hover:border-indigo-500/70 hover:bg-slate-100/80 dark:hover:border-indigo-500/60 dark:hover:bg-slate-900/70"
        }`}
      >
        {selectedFile ? (
          <div className="space-y-3">
            <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-500/15 border border-emerald-300 dark:border-emerald-500/30 mx-auto flex items-center justify-center text-emerald-600 dark:text-emerald-400 text-xl font-bold shadow-sm">
              ✓
            </div>
            <div>
              <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300 break-all px-2">
                {selectedFile.name}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono">
                {formatSize(selectedFile.size)} · ready for ingestion
              </p>
            </div>
            <button
              type="button"
              onClick={clearFile}
              disabled={loading}
              className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 underline underline-offset-2 disabled:opacity-40 transition-colors"
            >
              Choose a different file
            </button>
          </div>
        ) : (
          <div className="space-y-2.5">
            <div className="w-12 h-12 rounded-full bg-slate-200 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 mx-auto flex items-center justify-center text-slate-600 dark:text-slate-400 text-xl shadow-inner">
              📁
            </div>
            <p className="text-slate-700 dark:text-slate-200 text-sm font-medium">
              Drag &amp; drop your CSV file here, or{" "}
              <span className="text-indigo-600 dark:text-indigo-400 font-semibold underline underline-offset-2 hover:text-indigo-800 dark:hover:text-indigo-300">
                browse computer
              </span>
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Accepted format: <span className="text-slate-700 dark:text-slate-300 font-mono font-medium">.csv</span> only · max{" "}
              {formatSize(MAX_BYTES)}
            </p>
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        disabled={loading}
        onChange={handleFileChange}
      />

      {/* Local Client Validation Error */}
      {localError && (
        <div
          role="alert"
          className="rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2"
        >
          <span className="font-bold">✕</span>
          <span>{localError}</span>
        </div>
      )}

      <label className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer select-none">
        <input
          type="checkbox"
          className="mt-0.5 rounded border-slate-400 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500"
          checked={replaceExisting}
          disabled={loading}
          onChange={(e) => setReplaceExisting(e.target.checked)}
        />
        <span>
          <span className="font-semibold text-slate-800 dark:text-slate-200">Replace existing data</span>
          {" — "}clears D1 before ingest so a second CSV does not mix with the first.
        </span>
      </label>

      {/* Ingest Action Button */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!selectedFile || loading}
        aria-disabled={!selectedFile || loading}
        className={`w-full py-3 px-4 rounded-xl font-semibold text-sm transition-all duration-150 flex items-center justify-center gap-2 shadow-md ${
          loading
            ? "bg-indigo-600/80 text-white cursor-wait"
            : selectedFile
              ? "bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white shadow-indigo-600/25 cursor-pointer"
              : "bg-slate-200 dark:bg-slate-800/70 border border-slate-300 dark:border-slate-700/60 text-slate-500 dark:text-slate-400 cursor-not-allowed"
        }`}
      >
        {loading ? (
          <>
            <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            Ingesting &amp; validating logs…
          </>
        ) : selectedFile ? (
          "Upload & Ingest CSV →"
        ) : (
          "Select a file first"
        )}
      </button>

      {/* Progress Feedback during Upload */}
      {loading && (
        <div className="space-y-2 pt-1" aria-live="polite">
          <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
            <div className="h-full w-2/3 rounded-full bg-indigo-500 animate-pulse" />
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 text-center">
            Cleaning data quality defects and writing to Cloudflare D1…
          </p>
        </div>
      )}
    </div>
  );
}
