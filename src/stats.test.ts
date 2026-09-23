/**
 * stats.test.ts — unit tests for queryStats (dual-agent SLA logic,
 * p50/p95 percentiles, incident detection, error breakdown).
 *
 * We don't spin up a real D1 instance here. Instead we provide a minimal
 * mock of D1Database that returns fixture data from a pre-built in-memory
 * array. This keeps the tests fast and self-contained.
 */

import { describe, it, expect } from "vitest";
import { queryStats, type ServiceStats } from "./db";

// ---------------------------------------------------------------------------
// D1 mock
// ---------------------------------------------------------------------------

/**
 * Builds a mock D1Database that responds to the single SELECT query that
 * queryStats issues. The mock ignores WHERE clauses and returns all rows —
 * sufficient for these unit tests since we control the fixture data.
 */
interface MockRow {
  service_id: string;
  service_name: string;
  ts_utc: string;
  status_code: number;
  latency_ms: number | null;
}

function makeMockD1(rows: MockRow[]): D1Database {
  // Sort rows by service_id, ts_utc as the real query does (ORDER BY clause).
  const sorted = [...rows].sort((a, b) => {
    if (a.service_id !== b.service_id)
      return a.service_id.localeCompare(b.service_id);
    return a.ts_utc.localeCompare(b.ts_utc);
  });

  return {
    prepare: () => ({
      bind: (..._args: unknown[]) => ({
        all: async () => ({ results: sorted }),
        first: async () => null,
        run: async () => ({ meta: {} }),
      }),
    }),
    batch: async () => [],
    dump: async () => new ArrayBuffer(0),
    exec: async () => ({ count: 0, duration: 0 }),
  } as unknown as D1Database;
}

// ---------------------------------------------------------------------------
// Fixtures helpers
// ---------------------------------------------------------------------------

function slot(
  ts: string,
  status: number,
  latency: number | null,
  agent = "agent-1",
  serviceId = "svc-a",
  serviceName = "service-a"
): MockRow {
  return {
    service_id: serviceId,
    service_name: serviceName,
    ts_utc: ts,
    status_code: status,
    latency_ms: latency,
  };
}

// A sequence of UTC timestamps 15 minutes apart starting from a base
function ts(baseHour: number, slot15: number): string {
  const totalMin = baseHour * 60 + slot15 * 15;
  const h = Math.floor(totalMin / 60)
    .toString()
    .padStart(2, "0");
  const m = (totalMin % 60).toString().padStart(2, "0");
  return `2025-05-01T${h}:${m}:00.000Z`;
}

// ---------------------------------------------------------------------------
// Test 1: All-200 service → 100% uptime, SLA compliant, no incidents
// ---------------------------------------------------------------------------
describe("All-200 service", () => {
  it("reports 100% uptime and SLA compliant", async () => {
    const rows: MockRow[] = [
      slot(ts(0, 0), 200, 100),
      slot(ts(0, 1), 200, 200),
      slot(ts(0, 2), 200, 150),
      slot(ts(0, 3), 200, 300),
    ];

    const result = await queryStats(makeMockD1(rows), {});
    const svc = result.services[0];

    expect(svc.total_slots).toBe(4);
    expect(svc.sla_slots_down).toBe(0);
    expect(svc.uptime_pct).toBe(100);
    expect(svc.sla_compliant).toBe(true);
    expect(svc.incident_count).toBe(0);
    expect(svc.incidents).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Service with a consecutive run of 5xx → incident detected
// ---------------------------------------------------------------------------
describe("Incident detection — consecutive 5xx run", () => {
  it("detects a single incident with correct start/end/duration", async () => {
    const rows: MockRow[] = [
      slot(ts(0, 0), 200, 100), // up
      slot(ts(0, 1), 500, 900), // down — incident start
      slot(ts(0, 2), 503, 950), // down
      slot(ts(0, 3), 500, 920), // down — incident end
      slot(ts(0, 4), 200, 110), // up
    ];

    const result = await queryStats(makeMockD1(rows), {});
    const svc = result.services[0];

    expect(svc.sla_slots_down).toBe(3);
    expect(svc.uptime_pct).toBeCloseTo((2 / 5) * 100, 2);
    expect(svc.sla_compliant).toBe(false);
    expect(svc.incident_count).toBe(1);
    expect(svc.incidents[0].start).toBe(ts(0, 1));
    expect(svc.incidents[0].end).toBe(ts(0, 3));
    expect(svc.incidents[0].duration_min).toBe(45); // 3 slots × 15 min
  });

  it("does not pull a trailing 18:00 blip into the 16:00–17:15 reports window", async () => {
    // dataset_incident_log.json: svc-reports day 5 ~16:00-17:15 UTC
    const rows: MockRow[] = [
      slot("2025-05-13T16:00:00.000Z", 500, null),
      slot("2025-05-13T16:15:00.000Z", 500, null),
      slot("2025-05-13T16:30:00.000Z", 200, 100),
      slot("2025-05-13T16:45:00.000Z", 500, null),
      slot("2025-05-13T17:00:00.000Z", 200, 100),
      slot("2025-05-13T17:15:00.000Z", 500, null),
      slot("2025-05-13T17:30:00.000Z", 500, null),
      slot("2025-05-13T17:45:00.000Z", 200, 100),
      slot("2025-05-13T18:00:00.000Z", 500, null),
    ];

    const result = await queryStats(makeMockD1(rows), {});
    const inc = result.services[0].incidents;
    expect(inc).toHaveLength(1);
    expect(inc[0].start).toBe("2025-05-13T16:00:00.000Z");
    expect(inc[0].end).toBe("2025-05-13T17:30:00.000Z");
  });

  it("merges nearby downs (≤30 min gap) into one seed-log incident", async () => {
    // Mirrors dataset_incident_log.json: injected windows include up slots.
    const rows: MockRow[] = [
      slot(ts(0, 0), 500, null),
      slot(ts(0, 1), 200, 100), // 15-min up — still same burst
      slot(ts(0, 2), 503, null),
      slot(ts(0, 3), 502, null),
    ];

    const result = await queryStats(makeMockD1(rows), {});
    const svc = result.services[0];

    expect(svc.incident_count).toBe(1);
    expect(svc.incidents[0].start).toBe(ts(0, 0));
    expect(svc.incidents[0].end).toBe(ts(0, 3));
  });

  it("does not count isolated single-slot blips as incidents", async () => {
    const rows: MockRow[] = [
      slot(ts(0, 0), 200, 100),
      slot(ts(0, 1), 500, null), // lone blip
      slot(ts(0, 2), 200, 100),
      slot(ts(0, 8), 503, null), // far from the first blip
      slot(ts(0, 9), 200, 100),
    ];

    const result = await queryStats(makeMockD1(rows), {});
    expect(result.services[0].incident_count).toBe(0);
  });

  it("keeps two bursts that are hours apart as separate incidents", async () => {
    const rows: MockRow[] = [
      slot(ts(0, 0), 500, null),
      slot(ts(0, 1), 500, null),
      slot(ts(0, 2), 500, null),
      slot(ts(0, 3), 200, 100),
      slot(ts(8, 0), 502, null),
      slot(ts(8, 1), 502, null),
      slot(ts(8, 2), 502, null),
    ];

    const result = await queryStats(makeMockD1(rows), {});
    expect(result.services[0].incident_count).toBe(2);
  });

  it("flushes an open incident at the end of the range", async () => {
    const rows: MockRow[] = [
      slot(ts(0, 0), 200, 100),
      slot(ts(0, 1), 500, null),
      slot(ts(0, 2), 500, null),
      slot(ts(0, 3), 500, null),
    ];

    const result = await queryStats(makeMockD1(rows), {});
    const svc = result.services[0];

    expect(svc.incident_count).toBe(1);
    expect(svc.incidents[0].duration_min).toBe(45);
  });
});

describe("Monthly SLA flag vs date filter", () => {
  it("keeps the 99.9% flag on the calendar month, not a single good day", async () => {
    const rows: MockRow[] = [
      slot("2025-05-01T00:00:00.000Z", 500, null),
      slot("2025-05-01T00:15:00.000Z", 500, null),
      slot("2025-05-13T12:00:00.000Z", 200, 100),
      slot("2025-05-13T12:15:00.000Z", 200, 100),
    ];

    const goodDay = await queryStats(makeMockD1(rows), {
      from: "2025-05-13T00:00:00.000Z",
      to: "2025-05-13T23:59:59.999Z",
    });
    const svc = goodDay.services[0];

    expect(svc.uptime_pct).toBe(100);
    expect(svc.monthly_uptime_pct).toBe(50);
    expect(svc.sla_compliant).toBe(false);
    expect(svc.sla_month).toBe("2025-05");
    expect(goodDay.overall.sla_compliant).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 3: status_code 999 → counted as down, separate error bucket
// ---------------------------------------------------------------------------
describe("status_code 999 — probe failure", () => {
  it("counts 999 slots as down for SLA purposes", async () => {
    const rows: MockRow[] = [
      slot(ts(0, 0), 200, 100),
      slot(ts(0, 1), 999, 500), // probe failure — counts as down
      slot(ts(0, 2), 200, 150),
    ];

    const result = await queryStats(makeMockD1(rows), {});
    const svc = result.services[0];

    expect(svc.sla_slots_down).toBe(1);
    expect(svc.error_breakdown["999"]).toBe(1);
    // 999 must NOT be merged into 500/502/503
    expect(svc.error_breakdown["500"]).toBeUndefined();
  });

  it("keeps 999 in its own key separate from real 5xx codes", async () => {
    const rows: MockRow[] = [
      slot(ts(0, 0), 500, null),
      slot(ts(0, 1), 999, null),
      slot(ts(0, 2), 502, null),
    ];

    const result = await queryStats(makeMockD1(rows), {});
    const svc = result.services[0];

    // Assert exact error buckets: 999 must be its own key, never merged with 5xx.
    expect(svc.error_breakdown["999"]).toBe(1);
    expect(svc.error_breakdown["500"]).toBe(1);
    expect(svc.error_breakdown["502"]).toBe(1);
    // No extra keys should appear
    expect(Object.keys(svc.error_breakdown).sort()).toEqual(["500", "502", "999"]);
    // All 3 slots are down
    expect(svc.sla_slots_down).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Test 4: Dual-agent conflict — pessimistic policy
// ---------------------------------------------------------------------------
describe("Dual-agent SLA resolution — pessimistic policy", () => {
  it("counts a slot as DOWN if either agent reports non-2xx", async () => {
    // agent-1 says 200, agent-2 says 500 — slot must be DOWN
    const conflictTs = ts(0, 0);
    const rows: MockRow[] = [
      { ...slot(conflictTs, 200, 150, "agent-1"), },
      { ...slot(conflictTs, 500, 900, "agent-2"), },
    ];

    const result = await queryStats(makeMockD1(rows), {});
    const svc = result.services[0];

    // Only 1 unique slot, and it should be DOWN
    expect(svc.total_slots).toBe(1);
    expect(svc.sla_slots_down).toBe(1);
    expect(svc.sla_compliant).toBe(false);
    // Both raw rows' latencies should be included
    expect(svc.p50_latency_ms).not.toBeNull();
  });

  it("counts a slot as UP only if ALL agents report 200", async () => {
    const agreeTs = ts(0, 0);
    const rows: MockRow[] = [
      { ...slot(agreeTs, 200, 100, "agent-1"), },
      { ...slot(agreeTs, 200, 110, "agent-2"), },
    ];

    const result = await queryStats(makeMockD1(rows), {});
    const svc = result.services[0];

    expect(svc.total_slots).toBe(1);
    expect(svc.sla_slots_down).toBe(0);
    expect(svc.sla_compliant).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 5: Latency percentiles
// ---------------------------------------------------------------------------
describe("Latency percentiles — p50 and p95", () => {
  it("returns null for p50/p95 when all latencies are null", async () => {
    const rows: MockRow[] = [
      slot(ts(0, 0), 200, null),
      slot(ts(0, 1), 200, null),
    ];

    const result = await queryStats(makeMockD1(rows), {});
    const svc = result.services[0];

    expect(svc.p50_latency_ms).toBeNull();
    expect(svc.p95_latency_ms).toBeNull();
  });

  it("excludes null latency rows from percentile calculations", async () => {
    const rows: MockRow[] = [
      slot(ts(0, 0), 200, null),   // excluded
      slot(ts(0, 1), 200, 100),
      slot(ts(0, 2), 200, 200),
      slot(ts(0, 3), 200, 300),
      slot(ts(0, 4), 200, 400),
    ];

    const result = await queryStats(makeMockD1(rows), {});
    const svc = result.services[0];

    // 4 valid values: [100, 200, 300, 400]
    // p50 = value at ceil(0.5 * 4) - 1 = index 1 = 200
    expect(svc.p50_latency_ms).toBe(200);
    // p95 = value at ceil(0.95 * 4) - 1 = index 3 = 400
    expect(svc.p95_latency_ms).toBe(400);
  });

  it("includes latency readings from both agents in the same slot", async () => {
    // Two agents for the same ts_utc — both latencies should count
    const sharedTs = ts(0, 0);
    const rows: MockRow[] = [
      { ...slot(sharedTs, 200, 100, "agent-1"), },
      { ...slot(sharedTs, 200, 900, "agent-2"), },
    ];

    const result = await queryStats(makeMockD1(rows), {});
    const svc = result.services[0];

    // sorted: [100, 900] → p95 = 900
    expect(svc.p95_latency_ms).toBe(900);
  });
});

// ---------------------------------------------------------------------------
// Test 6: Overall stats aggregate across services
// ---------------------------------------------------------------------------
describe("Overall stats", () => {
  it("averages uptime across services", async () => {
    // svc-a: 4/4 slots up = 100%
    // svc-b: 3/4 slots up = 75%
    // overall average = 87.5%
    const rows: MockRow[] = [
      { service_id: "svc-a", service_name: "a", ts_utc: ts(0, 0), status_code: 200, latency_ms: 100 },
      { service_id: "svc-a", service_name: "a", ts_utc: ts(0, 1), status_code: 200, latency_ms: 100 },
      { service_id: "svc-a", service_name: "a", ts_utc: ts(0, 2), status_code: 200, latency_ms: 100 },
      { service_id: "svc-a", service_name: "a", ts_utc: ts(0, 3), status_code: 200, latency_ms: 100 },
      { service_id: "svc-b", service_name: "b", ts_utc: ts(0, 0), status_code: 200, latency_ms: 100 },
      { service_id: "svc-b", service_name: "b", ts_utc: ts(0, 1), status_code: 200, latency_ms: 100 },
      { service_id: "svc-b", service_name: "b", ts_utc: ts(0, 2), status_code: 200, latency_ms: 100 },
      { service_id: "svc-b", service_name: "b", ts_utc: ts(0, 3), status_code: 500, latency_ms: null },
    ];

    const result = await queryStats(makeMockD1(rows), {});

    expect(result.services).toHaveLength(2);
    expect(result.overall.uptime_pct).toBeCloseTo(87.5, 2);
    expect(result.overall.sla_compliant).toBe(false);
    expect(result.overall.non_compliant_services).toContain("svc-b");
    expect(result.overall.non_compliant_services).not.toContain("svc-a");
    expect(result.overall.total_checks).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// Test 7: Empty dataset
// ---------------------------------------------------------------------------
describe("Empty dataset", () => {
  it("returns empty services and 100% overall when no rows match", async () => {
    const result = await queryStats(makeMockD1([]), {});

    expect(result.services).toHaveLength(0);
    expect(result.overall.uptime_pct).toBe(100);
    expect(result.overall.total_checks).toBe(0);
    expect(result.overall.from_ts).toBeNull();
    expect(result.overall.to_ts).toBeNull();
  });
});
