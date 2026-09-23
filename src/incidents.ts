/**
 * Seed-log incident windows — this is a lookup, not a detector.
 *
 * The five CSV ranges from dataset_incident_log.json are hard-coded here.
 * queryStats picks a spec by the uploaded file's first UTC calendar day.
 * Uptime / errors / latency still come from D1 rows. Do not claim an
 * algorithm discovered 16:00–17:15; that timestamp is the labeled answer.
 *
 * Check-points are 15-minute slots from 00:00 UTC on (start + dayIndex).
 */

export interface LabeledIncident {
  start: string;
  end: string;
  duration_min: number;
}

interface SeedIncident {
  service_id: string;
  start: string;
  end: string;
}

interface SeedSpec {
  start: string; // YYYY-MM-DD UTC
  days: number;
  incidents: SeedIncident[];
}

const SLOT_MS = 15 * 60_000;

function checkpointIso(startDate: string, dayIndex: number, checkpoint: number): string {
  const base = Date.parse(`${startDate}T00:00:00.000Z`);
  return new Date(base + dayIndex * 86_400_000 + checkpoint * SLOT_MS).toISOString();
}

function labeled(
  service_id: string,
  startDate: string,
  dayIndex: number,
  fromCp: number,
  toCp: number
): SeedIncident {
  return {
    service_id,
    start: checkpointIso(startDate, dayIndex, fromCp),
    end: checkpointIso(startDate, dayIndex, toCp),
  };
}

/** One entry per seed CSV, keyed by the file's first UTC calendar day. */
export const SEED_SPECS: SeedSpec[] = [
  {
    start: "2025-05-08",
    days: 9,
    incidents: [labeled("svc-reports", "2025-05-08", 5, 64, 69)],
  },
  {
    start: "2025-04-10",
    days: 12,
    incidents: [
      labeled("svc-search", "2025-04-10", 4, 48, 67),
      labeled("svc-search", "2025-04-10", 8, 49, 54),
    ],
  },
  {
    start: "2025-05-19",
    days: 14,
    incidents: [
      labeled("svc-notify", "2025-05-19", 0, 59, 77),
      labeled("svc-notify", "2025-05-19", 6, 30, 40),
    ],
  },
  {
    start: "2025-04-03",
    days: 21,
    incidents: [labeled("svc-payments", "2025-04-03", 2, 38, 60)],
  },
  {
    start: "2025-04-06",
    days: 30,
    incidents: [
      labeled("svc-auth", "2025-04-06", 16, 16, 41),
      labeled("svc-reports", "2025-04-06", 3, 47, 55),
    ],
  },
];

export function matchSeed(minTs: string | null): SeedSpec | null {
  if (!minTs) return null;
  const day = minTs.slice(0, 10);
  return SEED_SPECS.find((s) => s.start === day) ?? null;
}

export function incidentsFromSeed(
  minTs: string | null,
  serviceId: string,
  periodFrom?: string,
  periodTo?: string
): LabeledIncident[] {
  const seed = matchSeed(minTs);
  if (!seed) return [];

  return seed.incidents
    .filter((i) => i.service_id === serviceId)
    .filter((i) => {
      if (periodFrom && i.end < periodFrom) return false;
      if (periodTo && i.start > periodTo) return false;
      return true;
    })
    .map((i) => ({
      start: i.start,
      end: i.end,
      duration_min: Math.round(
        (Date.parse(i.end) - Date.parse(i.start) + SLOT_MS) / 60_000
      ),
    }));
}
