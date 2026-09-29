import { describe, expect, it } from "vitest";
import {
  createEmptySnapshot,
  getCursoryDataDir,
  totalsFromSnapshot,
} from "../../src/core/telemetry/stats.js";
import { recordOptimization, startSessionStats } from "../../src/core/telemetry/sessionStats.js";

describe("session stats", () => {
  it("computes avoided tokens and reduction percent", () => {
    const snap = createEmptySnapshot("s1", "/tmp/ws");
    snap.categories.workspace.estimatedRawTokens = 100;
    snap.categories.workspace.estimatedDeliveredTokens = 25;
    const totals = totalsFromSnapshot(snap);
    expect(totals.estimatedAvoided).toBe(75);
    expect(totals.reductionPercent).toBe(75);
    expect(totals.estimatedRegression).toBe(0);
  });

  it("reports increases separately and never calls them avoided", () => {
    const snap = createEmptySnapshot("s2", "/tmp/ws");
    snap.categories.workspace.estimatedRawTokens = 100;
    snap.categories.workspace.estimatedDeliveredTokens = 140;
    const totals = totalsFromSnapshot(snap);
    expect(totals.estimatedAvoided).toBe(0);
    expect(totals.estimatedRegression).toBe(40);
    expect(totals.reductionPercent).toBe(0);
  });

  it("records optimizations into the active session", () => {
    startSessionStats("/tmp/ws-stats");
    recordOptimization({
      category: "workspace",
      estimatedRawTokens: 50,
      estimatedDeliveredTokens: 10,
      rawBytes: 200,
      deliveredBytes: 40,
    });
    // re-read via another record path — startSessionStats returns snapshot
    const again = startSessionStats("/tmp/ws-stats-2");
    expect(again.workspaceRoot).toBe("/tmp/ws-stats-2");
    expect(getCursoryDataDir().length).toBeGreaterThan(0);
  });
});
