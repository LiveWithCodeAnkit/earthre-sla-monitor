import { useState } from "react";
import { Link } from "react-router-dom";
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
    <div className="min-h-screen bg-gray-50 flex items-start justify-center pt-16 px-4">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">SLA Monitor</h1>
          <p className="mt-1 text-gray-500 text-sm">
            Upload a health-check CSV to ingest into the dashboard.
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
          <UploadForm onUpload={handleUpload} loading={loading} />

          {/* Error state */}
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-4">
              <p className="text-red-700 text-sm font-medium">Upload failed</p>
              <p className="text-red-600 text-sm mt-1">{error}</p>
            </div>
          )}

          {/* Success state */}
          {result && (
            <div className="rounded-lg bg-green-50 border border-green-200 p-4 space-y-3">
              <p className="text-green-800 font-semibold text-sm">
                ✓ {result.filename} ingested successfully
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white rounded-md border border-green-200 p-3 text-center">
                  <p className="text-2xl font-bold text-green-700">
                    {result.row_count.toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">rows inserted</p>
                </div>
                <div className="bg-white rounded-md border border-green-200 p-3 text-center">
                  <p className={`text-2xl font-bold ${result.rejected_count > 0 ? "text-amber-600" : "text-gray-400"}`}>
                    {result.rejected_count.toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">rejected / skipped</p>
                </div>
              </div>

              {result.rejected_sample.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowReasons(!showReasons)}
                    className="text-xs text-amber-700 underline"
                  >
                    {showReasons ? "Hide" : "Show"} rejection reasons
                  </button>
                  {showReasons && (
                    <ul className="mt-2 space-y-1">
                      {result.rejected_sample.map((r, i) => (
                        <li key={i} className="text-xs text-gray-600 font-mono bg-amber-50 rounded px-2 py-1">
                          {r}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <Link
                to="/dashboard"
                className="block w-full text-center py-2 px-4 bg-blue-600 text-white rounded-lg
                  text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                View Dashboard →
              </Link>
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-gray-400">
          Already have data?{" "}
          <Link to="/dashboard" className="text-blue-500 hover:underline">
            Go to dashboard
          </Link>
        </p>
      </div>
    </div>
  );
}
