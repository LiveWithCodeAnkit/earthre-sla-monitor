import { describe, expect, it } from "vitest";
import { likeContains, normalizeLogSearch, queryLogs } from "./db";

describe("normalizeLogSearch", () => {
  it("returns undefined for blank input", () => {
    expect(normalizeLogSearch(undefined)).toBeUndefined();
    expect(normalizeLogSearch("")).toBeUndefined();
    expect(normalizeLogSearch("   ")).toBeUndefined();
  });

  it("trims and caps at 80 characters", () => {
    expect(normalizeLogSearch("  agent-2  ")).toBe("agent-2");
    expect(normalizeLogSearch("x".repeat(90))?.length).toBe(80);
  });
});

describe("likeContains", () => {
  it("wraps the term in % and escapes LIKE wildcards", () => {
    expect(likeContains("agent-2")).toBe("%agent-2%");
    expect(likeContains("100%")).toBe("%100\\%%");
    expect(likeContains("svc_auth")).toBe("%svc\\_auth%");
  });
});

describe("queryLogs search SQL", () => {
  it("applies q to COUNT and page query, not only the current OFFSET page", async () => {
    const sqls: string[] = [];
    const binds: unknown[][] = [];
    const db = {
      prepare: (sql: string) => {
        sqls.push(sql);
        return {
          bind: (...args: unknown[]) => {
            binds.push(args);
            return {
              first: async () => ({ total: 38 }),
              all: async () => ({ results: [] }),
            };
          },
        };
      },
    } as unknown as D1Database;

    const result = await queryLogs(db, {
      from: "2025-05-16T00:00:00.000Z",
      to: "2025-05-16T23:59:59.999Z",
      q: "agent-2",
      page: 5,
      pageSize: 5,
    });

    expect(result.total).toBe(38);
    expect(result.page).toBe(5);
    expect(sqls).toHaveLength(2);
    expect(sqls[0]).toMatch(/COUNT\(\*\)/);
    expect(sqls[0]).toMatch(/agent LIKE \? ESCAPE/);
    expect(sqls[1]).toMatch(/LIMIT \? OFFSET \?/);
    expect(sqls[1]).toMatch(/agent LIKE \? ESCAPE/);
    expect(binds[0]).toEqual([
      "2025-05-16T00:00:00.000Z",
      "2025-05-16T23:59:59.999Z",
      "%agent-2%",
      "%agent-2%",
      "%agent-2%",
      "%agent-2%",
      "%agent-2%",
    ]);
    expect(binds[1].slice(-2)).toEqual([5, 20]);
  });
});
