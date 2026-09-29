import { describe, expect, it } from "vitest";
import { StatsStore, type MementoLike } from "../../src/ui/StatsStore.js";
import type { OptimizationRecordInput } from "../../src/ui/stats.js";
import {
  HISTORY_LIMIT,
  addRecord,
  createEmptyStats,
  normalizeRecord,
  recoverStats,
  statusBarText,
} from "../../src/ui/stats.js";

class MemoryMemento implements MementoLike {
  readonly values = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, structuredClone(value));
  }
}

function record(overrides: Partial<OptimizationRecordInput> = {}): OptimizationRecordInput {
  return {
    id: "request-1",
    timestamp: 1,
    promptPreview: "Fix login refresh bug",
    baselineTokens: 8420,
    optimizedTokens: 4980,
    duplicateTokensRemoved: 1820,
    irrelevantTokensRemoved: 1120,
    compressionSavings: 500,
    bypassed: false,
    contextBreakdown: {
      currentPrompt: 182,
      recentConversation: 1320,
      historicalSummary: 410,
      projectContext: 2960,
      instructions: 110,
      metadata: 298,
    },
    relevantFiles: [],
    latencyMs: 40,
    ...overrides,
  };
}

describe("Cursory UI statistics", () => {
  it("calculates honest savings and reduction", () => {
    const result = normalizeRecord(record());
    expect(result.tokensSaved).toBe(3440);
    expect(result.reductionPercent).toBeCloseTo(40.855);
  });

  it("counts bypasses as zero savings", () => {
    const result = normalizeRecord(
      record({ bypassed: true, optimizedTokens: 3000, bypassReason: "not useful" }),
    );
    expect(result.optimizedTokens).toBe(result.baselineTokens);
    expect(result.tokensSaved).toBe(0);
    expect(result.reductionPercent).toBe(0);
  });

  it("rejects regressions and preserves the original token count", () => {
    const result = normalizeRecord(record({ baselineTokens: 4210, optimizedTokens: 4740 }));
    expect(result.regressionRejected).toBe(true);
    expect(result.bypassed).toBe(true);
    expect(result.attemptedOptimizedTokens).toBe(4740);
    expect(result.optimizedTokens).toBe(4210);
    expect(result.tokensSaved).toBe(0);
  });

  it("aggregates session and lifetime totals", () => {
    const first = addRecord(createEmptyStats(1), record());
    const second = addRecord(
      first,
      record({ id: "request-2", baselineTokens: 1000, optimizedTokens: 800 }),
    );
    expect(second.session.requestsSeen).toBe(2);
    expect(second.session.requestsOptimized).toBe(2);
    expect(second.session.tokensSaved).toBe(3640);
    expect(second.lifetime.tokensSaved).toBe(3640);
  });

  it("caps recent history and shortens prompt previews", () => {
    let stats = createEmptyStats(1);
    for (let index = 0; index < HISTORY_LIMIT + 5; index += 1) {
      stats = addRecord(
        stats,
        record({
          id: String(index),
          promptPreview: "x".repeat(200),
        }),
      );
    }
    expect(stats.history).toHaveLength(HISTORY_LIMIT);
    expect(stats.history[0]?.promptPreview).toHaveLength(120);
  });

  it("persists and resets statistics independently", async () => {
    const storage = new MemoryMemento();
    const store = new StatsStore(storage);
    await store.record(record());
    const restored = new StatsStore(storage);
    expect(restored.snapshot().lifetime.tokensSaved).toBe(3440);

    await restored.resetSession();
    expect(restored.snapshot().session.tokensSaved).toBe(0);
    expect(restored.snapshot().lifetime.tokensSaved).toBe(3440);
    await restored.resetLifetime();
    expect(restored.snapshot().lifetime.tokensSaved).toBe(0);
  });

  it("recovers safely from malformed stored values", () => {
    expect(recoverStats({ session: "bad" }).history).toEqual([]);
    expect(recoverStats(null).session.requestsSeen).toBe(0);
  });

  it("formats status bar states and display modes", () => {
    const stats = addRecord(createEmptyStats(1), record()).session;
    expect(statusBarText("percent", "active", stats)).toBe("Cursory · 41%");
    expect(statusBarText("saved", "active", stats)).toBe("Cursory · 3.4K saved");
    expect(statusBarText("percent", "bypassed", stats)).toBe("Cursory · Bypass");
    expect(statusBarText("hidden", "active", stats)).toBe("");
  });
});
