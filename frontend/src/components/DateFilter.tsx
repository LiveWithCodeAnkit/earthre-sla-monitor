import { useState } from "react";

export interface FilterValues {
  from?: string;
  to?: string;
  service?: string;
}

interface Props {
  services?: string[];           // list of service_ids for the dropdown
  onChange: (v: FilterValues) => void;
  initialValues?: FilterValues;
}

/** Single-date mode: sets from=YYYY-MM-DDT00:00:00Z, to=YYYY-MM-DDT23:59:59.999Z */
export default function DateFilter({ services, onChange, initialValues }: Props) {
  const [mode, setMode] = useState<"single" | "range">("single");
  const [date, setDate] = useState(initialValues?.from?.slice(0, 10) ?? "");
  const [from, setFrom] = useState(initialValues?.from?.slice(0, 10) ?? "");
  const [to, setTo] = useState(initialValues?.to?.slice(0, 10) ?? "");
  const [service, setService] = useState(initialValues?.service ?? "");

  function apply() {
    const v: FilterValues = {};
    if (service) v.service = service;

    if (mode === "single" && date) {
      v.from = `${date}T00:00:00.000Z`;
      v.to   = `${date}T23:59:59.999Z`;
    } else if (mode === "range") {
      if (from) v.from = `${from}T00:00:00.000Z`;
      if (to)   v.to   = `${to}T23:59:59.999Z`;
    }

    onChange(v);
  }

  function reset() {
    setDate(""); setFrom(""); setTo(""); setService("");
    onChange({});
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-4">
      <div className="flex flex-wrap items-end gap-3">

        {/* Mode toggle */}
        <div className="flex rounded-md border border-gray-300 overflow-hidden text-sm">
          <button
            onClick={() => setMode("single")}
            className={`px-3 py-1.5 transition-colors ${mode === "single" ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
          >
            Single date
          </button>
          <button
            onClick={() => setMode("range")}
            className={`px-3 py-1.5 transition-colors ${mode === "range" ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
          >
            Date range
          </button>
        </div>

        {/* Date input(s) */}
        {mode === "single" ? (
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        ) : (
          <>
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">From</label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">To</label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </>
        )}

        {/* Service filter */}
        {services && services.length > 0 && (
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Service</label>
            <select
              value={service}
              onChange={(e) => setService(e.target.value)}
              className="border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">All services</option>
              {services.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        )}

        {/* Action buttons */}
        <button
          onClick={apply}
          className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors"
        >
          Apply
        </button>
        <button
          onClick={reset}
          className="px-3 py-1.5 text-gray-500 text-sm rounded-md hover:bg-gray-100 transition-colors"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
