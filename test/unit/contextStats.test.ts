import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { startSessionStats, recordOptimization, recordSmartRead } from "../../src/core/telemetry/sessionStats.js";
import { buildContextStats } from "../../src/mcp/tools/contextStats.js";
import { buildSmartRead } from "../../src/mcp/tools/smartRead.js";
import { resetSessionContentCache } from "../../src/core/cache/sessionCache.js";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "mini-repo");

describe("cursory_context_stats", () => {
  beforeEach(() => {
    resetSessionContentCache();
    startSessionStats(fixtureRoot);
  });

  it("formats empty session with tip", () => {
    const result = buildContextStats(fixtureRoot);
    expect(result.hasActivity).toBe(false);
    expect(result.text).toContain("Cursory session");
    expect(result.text).toContain("estimates, not Cursor billing");
    expect(result.text).toContain("no optimizations recorded");
  });

  it("shows category avoided after recorded optimizations", () => {
    recordOptimization({
      category: "workspace",
      estimatedRawTokens: 1000,
      estimatedDeliveredTokens: 200,
    });
    recordSmartRead();
    const result = buildContextStats(fixtureRoot);
    expect(result.hasActivity).toBe(true);
    expect(result.text).toContain("Repository exploration");
    expect(result.text).toMatch(/Avoided\s+800/);
    expect(result.text).toContain("80.0%");
  });

  it("reflects smart_read activity", () => {
    buildSmartRead({
      workspaceRoot: fixtureRoot,
      path: "src/lib/PaymentService.ts",
      symbol: "processPayment",
    });
    const result = buildContextStats(fixtureRoot);
    expect(result.text).toMatch(/smart_read\s+1/);
  });
});
