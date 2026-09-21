/**
 * parser.test.ts — unit tests for CSV parsing and all 9 data quality issues.
 *
 * Each describe block is labeled with the issue number from the spec so it's
 * easy to trace a test failure back to a specific cleaning decision.
 */

import { describe, it, expect } from "vitest";
import { parseCSV } from "./parser";

// ---------------------------------------------------------------------------
// Helper: build a minimal valid CSV header + one data row
// ---------------------------------------------------------------------------
const HEADER = "service_id,service_name,timestamp,status_code,latency,latency_unit,agent,region";

function makeLine(overrides: Partial<{
  service_id: string;
  service_name: string;
  timestamp: string;
  status_code: string;
  latency: string;
  latency_unit: string;
  agent: string;
  region: string;
}>): string {
  const defaults = {
    service_id: "svc-test",
    service_name: "test-api",
    timestamp: "2025-05-13T12:45:00Z",
    status_code: "200",
    latency: "500",
    latency_unit: "ms",
    agent: "agent-1",
    region: "ap-south-1",
  };
  const r = { ...defaults, ...overrides };
  return `${r.service_id},${r.service_name},${r.timestamp},${r.status_code},${r.latency},${r.latency_unit},${r.agent},${r.region}`;
}

function csv(...lines: string[]): string {
  return [HEADER, ...lines].join("\n");
}

// ---------------------------------------------------------------------------
// Issue 1: Unix epoch timestamps
// ---------------------------------------------------------------------------
describe("Issue 1 — Unix epoch timestamp", () => {
  it("converts a 10-digit epoch (seconds) to UTC ISO", () => {
    // 1746938700 seconds = 2025-05-11T04:45:00.000Z (verified: node -e "console.log(new Date(1746938700*1000).toISOString())")
    const { rows, rejected } = parseCSV(csv(makeLine({ timestamp: "1746938700" })));
    expect(rejected).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].ts_utc).toBe("2025-05-11T04:45:00.000Z");
  });

  it("also handles 13-digit epoch (milliseconds) without double-multiplying", () => {
    // 1746938700000 ms = same point in time
    const { rows } = parseCSV(csv(makeLine({ timestamp: "1746938700000" })));
    expect(rows[0].ts_utc).toBe("2025-05-11T04:45:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// Issue 2: ISO 8601 with non-UTC timezone offset
// ---------------------------------------------------------------------------
describe("Issue 2 — Non-UTC ISO timestamp (e.g. +05:30)", () => {
  it("normalises +05:30 offset to UTC", () => {
    // 2025-05-13T02:00:00+05:30 = 2025-05-12T20:30:00.000Z
    const { rows, rejected } = parseCSV(
      csv(makeLine({ timestamp: "2025-05-13T02:00:00+05:30" }))
    );
    expect(rejected).toHaveLength(0);
    expect(rows[0].ts_utc).toBe("2025-05-12T20:30:00.000Z");
  });

  it("leaves a plain UTC Z timestamp unchanged in value", () => {
    const { rows } = parseCSV(csv(makeLine({ timestamp: "2025-05-13T12:45:00Z" })));
    expect(rows[0].ts_utc).toBe("2025-05-13T12:45:00.000Z");
  });

  it("rejects an unparseable timestamp", () => {
    const { rows, rejected } = parseCSV(csv(makeLine({ timestamp: "not-a-date" })));
    expect(rows).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/unparseable_timestamp/);
  });
});

// ---------------------------------------------------------------------------
// Issue 3: Mixed latency units (ms vs s)
// ---------------------------------------------------------------------------
describe("Issue 3 — Mixed latency units", () => {
  it("passes ms values through unchanged", () => {
    const { rows } = parseCSV(csv(makeLine({ latency: "707", latency_unit: "ms" })));
    expect(rows[0].latency_ms).toBe(707);
    expect(rows[0].latency_notes).toBeNull();
  });

  it("multiplies seconds by 1000", () => {
    const { rows } = parseCSV(csv(makeLine({ latency: "0.717", latency_unit: "s" })));
    expect(rows[0].latency_ms).toBeCloseTo(717, 1);
    expect(rows[0].latency_notes).toBeNull();
  });

  it("sets latency_ms to null and records a note for an unknown unit", () => {
    const { rows } = parseCSV(csv(makeLine({ latency: "500", latency_unit: "ns" })));
    expect(rows).toHaveLength(1); // row kept
    expect(rows[0].latency_ms).toBeNull();
    expect(rows[0].latency_notes).toMatch(/unknown_latency_unit/);
  });
});

// ---------------------------------------------------------------------------
// Issue 4: Blank latency
// ---------------------------------------------------------------------------
describe("Issue 4 — Blank latency", () => {
  it("stores NULL for blank latency and keeps the row", () => {
    const { rows, rejected } = parseCSV(
      csv(makeLine({ latency: "", latency_unit: "ms" }))
    );
    expect(rejected).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].latency_ms).toBeNull();
    expect(rows[0].latency_notes).toBe("blank_latency");
  });

  it("keeps a valid status_code on a blank-latency row", () => {
    const { rows } = parseCSV(csv(makeLine({ latency: "", status_code: "200" })));
    expect(rows[0].status_code).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Issue 5: Negative latency
// ---------------------------------------------------------------------------
describe("Issue 5 — Negative latency", () => {
  it("sets latency_ms to null but keeps the row (status_code still counts)", () => {
    const { rows, rejected } = parseCSV(
      csv(makeLine({ latency: "-286", latency_unit: "ms" }))
    );
    expect(rejected).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].latency_ms).toBeNull();
    expect(rows[0].latency_notes).toBe("negative_latency");
  });

  it("preserves status_code 200 on a negative-latency row", () => {
    const { rows } = parseCSV(csv(makeLine({ latency: "-342", status_code: "200" })));
    expect(rows[0].status_code).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Issue 6: status_code 999 (probe failure sentinel)
// ---------------------------------------------------------------------------
describe("Issue 6 — status_code 999 (probe failure)", () => {
  it("accepts rows with status_code 999 without rejection", () => {
    const { rows, rejected } = parseCSV(csv(makeLine({ status_code: "999" })));
    expect(rejected).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].status_code).toBe(999);
  });

  it("also accepts real 5xx codes without rejection", () => {
    for (const code of ["500", "502", "503"]) {
      const { rows } = parseCSV(csv(makeLine({ status_code: code })));
      expect(rows[0].status_code).toBe(parseInt(code, 10));
    }
  });

  it("rejects a non-numeric status_code", () => {
    const { rows, rejected } = parseCSV(csv(makeLine({ status_code: "2OO" }))); // letter O
    expect(rows).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/invalid_status_code/);
  });
});

// ---------------------------------------------------------------------------
// Issue 7: Dual-agent rows for the same (service_id, timestamp)
// ---------------------------------------------------------------------------
describe("Issue 7 — Dual-agent rows", () => {
  it("returns both agent rows without merging or deduplication", () => {
    const line1 = makeLine({ agent: "agent-1", status_code: "200", latency: "300" });
    const line2 = makeLine({ agent: "agent-2", status_code: "500", latency: "900" });
    const { rows, rejected } = parseCSV(csv(line1, line2));
    expect(rejected).toHaveLength(0);
    expect(rows).toHaveLength(2);
    // Both rows are present in the output; SLA resolution happens at query time
    const agents = rows.map((r) => r.agent).sort();
    expect(agents).toEqual(["agent-1", "agent-2"]);
  });
});

// ---------------------------------------------------------------------------
// Issue 8: Exact full-row duplicates
// ---------------------------------------------------------------------------
describe("Issue 8 — Exact full-row duplicates", () => {
  it("passes duplicate rows through (dedup handled by DB INSERT OR IGNORE)", () => {
    // parser.ts is intentionally stateless — it does not deduplicate rows.
    // The UNIQUE(service_id, ts_utc, agent) constraint in D1 + INSERT OR IGNORE
    // handles this at the DB layer. See db.ts for the INSERT logic.
    const line = makeLine({});
    const { rows, rejected } = parseCSV(csv(line, line, line));
    expect(rejected).toHaveLength(0);
    // All three are returned; duplicates are silently dropped by the DB
    expect(rows).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Issue 9: CRLF line endings
// ---------------------------------------------------------------------------
describe("Issue 9 — CRLF line endings", () => {
  it("parses Windows-style CRLF (\\r\\n) correctly", () => {
    const crlf = [HEADER, makeLine({})].join("\r\n");
    const { rows, rejected } = parseCSV(crlf);
    expect(rejected).toHaveLength(0);
    expect(rows).toHaveLength(1);
    // region should not have a trailing \r
    expect(rows[0].region).toBe("ap-south-1");
  });

  it("parses lone CR (\\r) correctly", () => {
    const cr = [HEADER, makeLine({})].join("\r");
    const { rows } = parseCSV(cr);
    expect(rows).toHaveLength(1);
    expect(rows[0].region).toBe("ap-south-1");
  });
});

// ---------------------------------------------------------------------------
// Row rejection: missing required fields
// ---------------------------------------------------------------------------
describe("Row rejection — missing required fields", () => {
  it("rejects a row with empty service_id", () => {
    const { rows, rejected } = parseCSV(csv(makeLine({ service_id: "" })));
    expect(rows).toHaveLength(0);
    expect(rejected[0].reason).toBe("missing_required_field");
  });

  it("rejects a row with too few fields", () => {
    const { rows, rejected } = parseCSV(`${HEADER}\nsvc-test,test-api`);
    expect(rows).toHaveLength(0);
    expect(rejected[0].reason).toBe("too_few_fields");
  });

  it("ignores blank trailing lines", () => {
    const { rows } = parseCSV(`${HEADER}\n${makeLine({})}\n\n\n`);
    expect(rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Combined: a realistic multi-row CSV with several issues in one pass
// ---------------------------------------------------------------------------
describe("Combined realistic CSV", () => {
  it("handles all issue types in a single parse call", () => {
    const lines = [
      makeLine({ timestamp: "1746938700", latency: "285", latency_unit: "ms" }),   // epoch ts
      makeLine({ timestamp: "2025-05-13T02:00:00+05:30", latency: "0.4", latency_unit: "s" }), // offset ts + s unit
      makeLine({ latency: "", latency_unit: "ms" }),                                // blank latency
      makeLine({ latency: "-150", latency_unit: "ms" }),                            // negative latency
      makeLine({ status_code: "999" }),                                              // probe failure
      makeLine({ status_code: "BAD" }),                                              // invalid → rejected
    ];
    const { rows, rejected } = parseCSV(csv(...lines));

    expect(rows).toHaveLength(5);   // 5 good rows
    expect(rejected).toHaveLength(1); // 1 rejected (invalid status_code)

    // Epoch timestamp correctly converted
    expect(rows[0].ts_utc).toBe("2025-05-11T04:45:00.000Z");

    // Seconds converted to ms
    expect(rows[1].latency_ms).toBeCloseTo(400, 1);

    // Blank latency → null
    expect(rows[2].latency_ms).toBeNull();
    expect(rows[2].latency_notes).toBe("blank_latency");

    // Negative latency → null, row kept
    expect(rows[3].latency_ms).toBeNull();
    expect(rows[3].latency_notes).toBe("negative_latency");
    expect(rows[3].status_code).toBe(200); // status_code preserved

    // 999 accepted
    expect(rows[4].status_code).toBe(999);

    // Rejected row reason
    expect(rejected[0].reason).toMatch(/invalid_status_code/);
  });
});
