import { describe, expect, it } from "vitest";
import { buildOptimizedContext } from "../../src/context/ContextPipeline.js";
import {
  onContextOptimization,
  type ContextOptimizationEvent,
} from "../../src/context/OptimizationEvents.js";

describe("optimizer UI event bridge", () => {
  it("reports measured pipeline results without affecting optimization", () => {
    let captured: ContextOptimizationEvent | undefined;
    const unsubscribe = onContextOptimization((event) => {
      captured = event;
    });

    const result = buildOptimizedContext({
      currentPrompt: "Fix refresh token handling",
      mode: "additive",
    });
    unsubscribe();

    expect(captured?.result).toBe(result);
    expect(captured?.prompt).toBe("Fix refresh token handling");
    expect(captured?.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.stats.tokensSaved).toBe(0);
  });

  it("isolates reporting failures from the optimization pipeline", () => {
    const unsubscribe = onContextOptimization(() => {
      throw new Error("UI unavailable");
    });
    expect(() =>
      buildOptimizedContext({
        currentPrompt: "Keep working",
        mode: "additive",
      }),
    ).not.toThrow();
    unsubscribe();
  });
});
