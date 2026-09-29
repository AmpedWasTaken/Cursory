import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, getRuntimeInfo } from "../../src/core/config/config.js";
import { CURSORY_NAME, CURSORY_PHASE, CURSORY_VERSION } from "../../src/core/config/defaults.js";

describe("config defaults", () => {
  it("uses balanced mode and documented budgets", () => {
    expect(DEFAULT_CONFIG.mode).toBe("balanced");
    expect(DEFAULT_CONFIG.budgets.workspaceMap).toBe(1600);
    expect(DEFAULT_CONFIG.budgets.search).toBe(2200);
    expect(DEFAULT_CONFIG.budgets.read).toBe(3200);
    expect(DEFAULT_CONFIG.budgets.terminal).toBe(2800);
    expect(DEFAULT_CONFIG.budgets.diff).toBe(2800);
    expect(DEFAULT_CONFIG.context.maxInjectedTokens).toBe(6000);
    expect(DEFAULT_CONFIG.context.instructionsBudget).toBeLessThanOrEqual(150);
    expect(DEFAULT_CONFIG.context.allowRegression).toBe(false);
    expect(DEFAULT_CONFIG.privacy.telemetry).toBe(false);
  });

  it("exposes runtime identity for Phase 9", () => {
    const info = getRuntimeInfo();
    expect(info.name).toBe(CURSORY_NAME);
    expect(info.version).toBe(CURSORY_VERSION);
    expect(info.phase).toBe(CURSORY_PHASE);
    expect(info.phase).toBe(9);
    expect(info.node).toMatch(/^v\d+/);
    expect(info.platform.length).toBeGreaterThan(0);
  });
});
