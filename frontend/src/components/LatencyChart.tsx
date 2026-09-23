import { useMemo, useState, type MouseEvent } from "react";
import type { ServiceStats } from "../api";

const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#f43f5e", "#38bdf8"];

type Metric = "p50" | "p95" | "both";

interface Point {
  day: string;
  p50: number | null;
  p95: number | null;
}

interface Series {
  id: string;
  name: string;
  color: string;
  points: Point[];
}

function niceTicks(maxValue: number): number[] {
  if (maxValue <= 0) return [0, 1];
  const padded = maxValue * 1.08;
  const rough = padded / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const n = rough / mag;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  const top = Math.ceil(padded / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
  return ticks;
}

function pick(p: Point, key: "p50" | "p95"): number | null {
  return key === "p50" ? p.p50 : p.p95;
}

function linePath(
  points: Point[],
  getter: (p: Point) => number | null,
  xAt: (i: number) => number,
  yAt: (v: number) => number
): string {
  const cmds: string[] = [];
  let started = false;
  points.forEach((p, i) => {
    const v = getter(p);
    if (v === null) return;
    cmds.push(`${started ? "L" : "M"} ${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`);
    started = true;
  });
  return cmds.join(" ");
}

function formatTick(v: number): string {
  if (v >= 1000) return `${Math.round(v / 100) / 10}k`.replace(".0k", "k");
  return String(Math.round(v));
}

interface PlotProps {
  series: Series[];
  days: string[];
  metric: Metric;
  width: number;
  height: number;
  compact?: boolean;
}

function LatencyPlot({ series, days, metric, width, height, compact }: PlotProps) {
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);

  const values = series.flatMap((s) =>
    s.points.flatMap((p) => {
      const out: number[] = [];
      if (metric !== "p95" && p.p50 !== null) out.push(p.p50);
      if (metric !== "p50" && p.p95 !== null) out.push(p.p95);
      return out;
    })
  );
  const ticks = niceTicks(Math.max(0, ...values));
  const maxY = ticks[ticks.length - 1] || 1;
  const pad = compact
    ? { top: 10, right: 10, bottom: 22, left: 36 }
    : { top: 14, right: 14, bottom: 32, left: 52 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const xAt = (i: number) =>
    pad.left + (days.length <= 1 ? innerW / 2 : (i / (days.length - 1)) * innerW);
  const yAt = (v: number) => pad.top + innerH - (v / maxY) * innerH;
  const labelEvery = days.length > 8 ? Math.ceil(days.length / 6) : 1;

  function onMove(e: MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (width / rect.width);
    let nearest = 0;
    let best = Infinity;
    days.forEach((_, i) => {
      const d = Math.abs(xAt(i) - sx);
      if (d < best) {
        best = d;
        nearest = i;
      }
    });
    setHover({ i: nearest, x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  const hi = hover?.i ?? -1;
  const tip = hover
    ? series.flatMap((s) => {
        const p = s.points[hover.i];
        const rows: { name: string; color: string; label: string; ms: number }[] = [];
        if (metric !== "p95" && p.p50 !== null)
          rows.push({ name: s.name, color: s.color, label: "p50", ms: p.p50 });
        if (metric !== "p50" && p.p95 !== null)
          rows.push({ name: s.name, color: s.color, label: "p95", ms: p.p95 });
        return rows;
      })
    : [];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
        role="img"
        aria-label="Latency line chart"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <text
          x={12}
          y={pad.top + innerH / 2}
          textAnchor="middle"
          transform={`rotate(-90 12 ${pad.top + innerH / 2})`}
          className="fill-slate-500 text-[10px]"
        >
          ms
        </text>
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={yAt(v)}
              y2={yAt(v)}
              className="stroke-slate-200 dark:stroke-slate-800"
              strokeWidth="1"
            />
            <text x={pad.left - 6} y={yAt(v) + 3} textAnchor="end" className="fill-slate-500 text-[10px]">
              {formatTick(v)}
            </text>
          </g>
        ))}
        {days.map((day, i) =>
          i % labelEvery === 0 ? (
            <text key={day} x={xAt(i)} y={height - 8} textAnchor="middle" className="fill-slate-500 text-[10px]">
              {day.slice(5)}
            </text>
          ) : null
        )}
        {hi >= 0 && (
          <line
            x1={xAt(hi)}
            x2={xAt(hi)}
            y1={pad.top}
            y2={pad.top + innerH}
            className="stroke-slate-400 dark:stroke-slate-500"
            strokeDasharray="3 3"
            strokeWidth="1"
          />
        )}
        {days.length === 1
          ? series.map((s, si) => {
              const keys: ("p50" | "p95")[] =
                metric === "both" ? ["p50", "p95"] : metric === "p50" ? ["p50"] : ["p95"];
              const n = series.length * keys.length;
              const groupW = Math.min(innerW * 0.7, Math.max(48, n * 18));
              const barW = Math.max(8, groupW / n - 3);
              const startX = pad.left + innerW / 2 - groupW / 2;
              return keys.map((k, ki) => {
                const v = pick(s.points[0], k);
                if (v === null) return null;
                const idx = si * keys.length + ki;
                const x = startX + idx * (barW + 3);
                const y = yAt(v);
                return (
                  <rect
                    key={`${s.id}-${k}`}
                    x={x}
                    y={y}
                    width={barW}
                    height={Math.max(0, yAt(0) - y)}
                    fill={s.color}
                    opacity={k === "p95" && metric === "both" ? 0.55 : 0.92}
                    rx="2"
                  />
                );
              });
            })
          : series.map((s) => (
              <g key={s.id}>
                {metric !== "p95" && (
                  <path
                    d={linePath(s.points, (p) => p.p50, xAt, yAt)}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={compact ? 1.5 : 2}
                    strokeLinejoin="round"
                  />
                )}
                {metric !== "p50" && (
                  <path
                    d={linePath(s.points, (p) => p.p95, xAt, yAt)}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={compact ? 1.25 : 1.75}
                    strokeDasharray={metric === "both" ? "4 3" : undefined}
                    strokeLinejoin="round"
                    opacity={metric === "both" ? 0.8 : 1}
                  />
                )}
                {s.points.map((p, i) => {
                  const keys: ("p50" | "p95")[] =
                    metric === "both" ? ["p50", "p95"] : metric === "p50" ? ["p50"] : ["p95"];
                  return keys.map((k) => {
                    const v = pick(p, k);
                    if (v === null) return null;
                    return (
                      <circle
                        key={`${s.id}-${k}-${p.day}`}
                        cx={xAt(i)}
                        cy={yAt(v)}
                        r={hi === i ? 3.5 : 2}
                        fill={s.color}
                      />
                    );
                  });
                })}
              </g>
            ))}
      </svg>
      {hover && tip.length > 0 && (
        <div
          className="pointer-events-none absolute z-10 min-w-[140px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 text-[11px] shadow-lg"
          style={{
            left: Math.min(hover.x + 12, width),
            top: Math.max(8, hover.y - 8),
            transform: hover.x > width * 0.55 ? "translateX(-110%)" : undefined,
          }}
        >
          <p className="font-mono font-semibold text-slate-800 dark:text-slate-200 mb-1">{days[hover.i]} UTC</p>
          {tip.map((row) => (
            <p key={`${row.name}-${row.label}`} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                <span className="w-2 h-2 rounded-full" style={{ background: row.color }} />
                {row.name} {metric === "both" ? row.label : ""}
              </span>
              <span className="font-mono text-slate-800 dark:text-slate-200">{row.ms} ms</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export default function LatencyChart({ services }: { services: ServiceStats[] }) {
  const [metric, setMetric] = useState<Metric>("p95");
  const [chartOpen, setChartOpen] = useState(true);

  const days = useMemo(() => {
    const set = new Set<string>();
    for (const svc of services) for (const p of svc.latency_series) set.add(p.day);
    return [...set].sort();
  }, [services]);

  const series = useMemo(
    () =>
      [...services]
        .sort((a, b) => a.service_id.localeCompare(b.service_id))
        .map((svc, i) => ({
          id: svc.service_id,
          name: svc.service_name,
          color: COLORS[i % COLORS.length],
          points: days.map((day) => {
            const row = svc.latency_series.find((p) => p.day === day);
            return { day, p50: row?.p50_ms ?? null, p95: row?.p95_ms ?? null };
          }),
        })),
    [services, days]
  );

  const hasValues = series.some((s) => s.points.some((p) => p.p50 !== null || p.p95 !== null));

  if (days.length === 0 || !hasValues) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-800 bg-white/50 dark:bg-slate-900/30 py-10 text-center">
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">No latency series in this range</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 shadow-xl shadow-slate-200/50 dark:shadow-black/20 p-5 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-400 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-indigo-500 dark:bg-indigo-400" />
            Latency by UTC day
          </h3>
          {chartOpen && (
            <p className="text-[11px] text-slate-500 mt-1">
              {days.length === 1
                ? `Only ${days[0]} has data in this filter — table shows that day. A line needs 2+ UTC days (this CSV is 8–16 May 2025).`
                : "Shared overlay plus per-service scale · null / negative readings excluded"}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {chartOpen && (
            <div className="inline-flex h-8 rounded-lg bg-slate-200/80 dark:bg-slate-950/80 border border-slate-300 dark:border-slate-800 p-0.5 text-xs font-medium">
              {(["p95", "p50", "both"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMetric(m)}
                  className={`px-2.5 py-1 rounded-md transition-all ${
                    metric === m
                      ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold shadow-sm"
                      : "text-slate-600 dark:text-slate-400"
                  }`}
                >
                  {m === "both" ? "p50 + p95" : m}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setChartOpen((o) => !o)}
            className="text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 bg-slate-100 dark:bg-slate-800/60 hover:bg-slate-200 dark:hover:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700/60 transition-colors"
            aria-expanded={chartOpen}
          >
            {chartOpen ? "Hide chart ▲" : "Show chart ▼"}
          </button>
        </div>
      </div>

      {chartOpen && (
        <>
          <LatencyPlot series={series} days={days} metric={metric} width={720} height={240} />

          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {series.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400">
                <span className="w-3 h-0.5 rounded" style={{ background: s.color }} />
                {s.name}
              </span>
            ))}
            {metric === "both" && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
                <span className="w-4 border-t border-dashed border-slate-500" />
                dashed = p95
              </span>
            )}
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
              Per service (own scale)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {series.map((s) => (
                <div
                  key={s.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 p-3"
                >
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 mb-1 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                    {s.name}
                  </p>
                  <LatencyPlot
                    series={[s]}
                    days={days}
                    metric={metric}
                    width={320}
                    height={140}
                    compact
                  />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
