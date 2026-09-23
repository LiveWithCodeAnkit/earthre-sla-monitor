import { describe, it, expect } from "vitest";
import { incidentsFromSeed, matchSeed } from "./incidents";

describe("seed-log incidents", () => {
  it("maps 9d start date to the reports 16:00–17:15 window", () => {
    expect(matchSeed("2025-05-08T00:00:00.000Z")?.start).toBe("2025-05-08");
    const inc = incidentsFromSeed("2025-05-08T00:00:00.000Z", "svc-reports");
    expect(inc).toEqual([
      {
        start: "2025-05-13T16:00:00.000Z",
        end: "2025-05-13T17:15:00.000Z",
        duration_min: 90,
      },
    ]);
    expect(incidentsFromSeed("2025-05-08T00:00:00.000Z", "svc-search")).toEqual([]);
  });

  it("maps 12d search to two labeled windows", () => {
    const inc = incidentsFromSeed("2025-04-10T00:00:00.000Z", "svc-search");
    expect(inc).toHaveLength(2);
    expect(inc[0]).toMatchObject({
      start: "2025-04-14T12:00:00.000Z",
      end: "2025-04-14T16:45:00.000Z",
    });
    expect(inc[1]).toMatchObject({
      start: "2025-04-18T12:15:00.000Z",
      end: "2025-04-18T13:30:00.000Z",
    });
  });
});
