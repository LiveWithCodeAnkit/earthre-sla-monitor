import { useRef, useState, DragEvent, ChangeEvent } from "react";

interface Props {
  onUpload: (file: File) => void;
  loading: boolean;
}

export default function UploadForm({ onUpload, loading }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setSelectedFile(f);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setSelectedFile(f);
  }

  function handleSubmit() {
    if (selectedFile) onUpload(selectedFile);
  }

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors
          ${dragging ? "border-blue-500 bg-blue-50" : "border-gray-300 hover:border-blue-400 hover:bg-gray-50"}`}
      >
        <p className="text-gray-600 text-sm">
          {selectedFile
            ? <span className="font-medium text-gray-900">{selectedFile.name}</span>
            : <>Drag &amp; drop a CSV file here, or <span className="text-blue-600 underline">browse</span></>
          }
        </p>
        {selectedFile && (
          <p className="text-xs text-gray-400 mt-1">
            {(selectedFile.size / 1024).toFixed(0)} KB
          </p>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={handleFileChange}
      />

      <button
        onClick={handleSubmit}
        disabled={!selectedFile || loading}
        className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg font-medium
          hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            Uploading…
          </span>
        ) : "Upload CSV"}
      </button>
    </div>
  );
}
