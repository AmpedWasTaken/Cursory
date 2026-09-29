import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { buildGetRaw } from "../../src/mcp/tools/getRaw.js";
import { resetSessionContentCache } from "../../src/core/cache/sessionCache.js";
import { buildSmartRead } from "../../src/mcp/tools/smartRead.js";
import { buildSmartSearch } from "../../src/mcp/tools/smartSearch.js";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "mini-repo");

describe("cursory_smart_search", () => {
  it("ranks PaymentService for a payment query", () => {
    const result = buildSmartSearch({
      workspaceRoot: fixtureRoot,
      query: "where is checkout payment processed",
      maxResults: 5,
    });
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits.some((h) => h.path.includes("PaymentService"))).toBe(true);
    expect(result.text).toContain("Query:");
    expect(result.estimatedDeliveredTokens).toBeLessThanOrEqual(result.estimatedRawTokens);
  }, 20_000);
});

describe("cursory_smart_read", () => {
  beforeEach(() => {
    resetSessionContentCache();
  });

  it("returns a symbol slice with exact source", () => {
    const result = buildSmartRead({
      workspaceRoot: fixtureRoot,
      path: "src/lib/PaymentService.ts",
      symbol: "processPayment",
    });
    expect(result.cacheHit).toBe(false);
    expect(result.text).toContain("processPayment");
    expect(result.text).toContain("async processPayment");
    expect(result.returnedLines).toBeLessThanOrEqual(result.totalLines);
    expect(result.estimatedDeliveredTokens).toBeLessThanOrEqual(
      result.estimatedRawTokens,
    );
    expect(result.selectionReason).toMatch(/symbol/);
  });

  it("dedupes unchanged slice via session cache and allows force_full", () => {
    const first = buildSmartRead({
      workspaceRoot: fixtureRoot,
      path: "src/lib/PaymentService.ts",
      symbol: "refreshToken",
    });
    expect(first.cacheHit).toBe(false);

    const second = buildSmartRead({
      workspaceRoot: fixtureRoot,
      path: "src/lib/PaymentService.ts",
      symbol: "refreshToken",
    });
    expect(second.cacheHit).toBe(true);
    expect(second.text).toContain("[cursory:duplicate]");
    expect(second.text).not.toContain("async refreshToken");
    expect(second.returnedLines).toBe(0);
    expect(second.estimatedDeliveredTokens).toBeLessThan(first.estimatedDeliveredTokens);

    const full = buildSmartRead({
      workspaceRoot: fixtureRoot,
      path: "src/lib/PaymentService.ts",
      forceFull: true,
    });
    expect(full.cacheHit).toBe(false);
    expect(full.returnedLines).toBe(full.totalLines);
    expect(full.text).toContain("refreshToken");
    expect(full.text).toContain("processPayment");
  });

  it("keeps force_full of a large file as a head plus get_raw id", () => {
    const root = join(tmpdir(), `cursory-large-read-${Date.now()}`);
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "package.json"), "{\"name\":\"large-read\"}\n");
    const lines = ["export function head() { return 1; }"];
    for (let i = 0; i < 400; i++) lines.push(`export const pad${i} = ${i};`);
    writeFileSync(join(root, "src", "big.ts"), `${lines.join("\n")}\n`);

    const result = buildSmartRead({
      workspaceRoot: root,
      path: "src/big.ts",
      forceFull: true,
    });
    expect(result.totalLines).toBeGreaterThan(200);
    expect(result.returnedLines).toBeLessThanOrEqual(200);
    expect(result.text).toContain("export function head");
    expect(result.text).not.toContain("export const pad399");
    expect(result.text).not.toMatch(/raw fallback/);
    expect(result.resultId).toBeTruthy();
    expect(result.text).toContain("cursory_get_raw");

    const raw = buildGetRaw({
      workspaceRoot: root,
      resultId: result.resultId!,
      search: "pad399",
    });
    expect(raw.found).toBe(true);
    expect(raw.text).toContain("pad399");
  });

  it("returns the exact tail of a large log, not the head", () => {
    const root = join(tmpdir(), `cursory-log-read-${Date.now()}`);
    mkdirSync(join(root, "tmp"), { recursive: true });
    writeFileSync(join(root, "package.json"), "{\"name\":\"log-read\"}\n");
    const lines = Array.from({ length: 400 }, (_, i) => `startup noise ${i}`);
    lines.push("FATAL: connection refused at shutdown");
    writeFileSync(join(root, "tmp", "app.log"), `${lines.join("\n")}\n`);

    const result = buildSmartRead({
      workspaceRoot: root,
      path: "tmp/app.log",
    });
    expect(result.text).toContain("FATAL: connection refused at shutdown");
    expect(result.text).not.toContain("startup noise 0");
    expect(result.selectionReason).toMatch(/tail/);
    expect(result.resultId).toBeTruthy();

    const listed = buildGetRaw({ workspaceRoot: root });
    expect(listed.text).toContain("recent stored raw results");
    expect(listed.text).toContain(result.resultId!);
  });

  it("rejects path traversal outside workspace", () => {
    expect(() =>
      buildSmartRead({
        workspaceRoot: fixtureRoot,
        path: "../outside.ts",
      }),
    ).toThrow(/escapes workspace/);
  });
});
