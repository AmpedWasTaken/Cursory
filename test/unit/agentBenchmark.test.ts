import { describe, expect, it } from "vitest";
import { parseAgentOutput } from "../../src/benchmark/agent/parseAgentOutput.js";
import { parseTaskDef } from "../../src/benchmark/agent/loadTask.js";
import { buildAgentReportSummary } from "../../src/benchmark/agent/summarizeAgentReport.js";
import { runAgentBenchmark } from "../../src/benchmark/agent/orchestrate.js";
import { isCursoryEnabled } from "../../src/core/runtime/enabled.js";
import type { AgentRunRecord } from "../../src/benchmark/agent/types.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("isCursoryEnabled", () => {
  it("respects CURSORY_ENABLED and legacy disable flag", () => {
    expect(isCursoryEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(isCursoryEnabled({ CURSORY_ENABLED: "0" } as NodeJS.ProcessEnv)).toBe(
      false,
    );
    expect(isCursoryEnabled({ CURSORY_ENABLED: "1" } as NodeJS.ProcessEnv)).toBe(
      true,
    );
    expect(
      isCursoryEnabled({
        CURSORY_DISABLE_TAKEOVER: "1",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });
});

describe("parseAgentOutput", () => {
  it("reads documented result duration and optional usage", () => {
    const parsed = parseAgentOutput(
      JSON.stringify({
        type: "result",
        subtype: "success",
        duration_ms: 14900,
        result: "done",
        session_id: "abc",
        usage: {
          inputTokens: 9119,
          outputTokens: 453,
          cacheReadTokens: 20430,
        },
      }),
    );
    expect(parsed.durationMs).toBe(14900);
    expect(parsed.inputTokens).toBe(9119);
    expect(parsed.metricsSource).toBe("agent-usage");
  });

  it("estimates from stream-json read tool chars when usage missing", () => {
    const lines = [
      JSON.stringify({
        type: "tool_call",
        subtype: "started",
        call_id: "1",
        tool_call: { readToolCall: { args: { path: "a.ts" } } },
      }),
      JSON.stringify({
        type: "tool_call",
        subtype: "completed",
        call_id: "1",
        tool_call: {
          readToolCall: {
            args: { path: "a.ts" },
            result: { success: { content: "x".repeat(400), totalChars: 400 } },
          },
        },
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        duration_ms: 1000,
        result: "ok",
      }),
    ].join("\n");
    const parsed = parseAgentOutput(lines);
    expect(parsed.metricsSource).toBe("stream-json-estimate");
    expect(parsed.readChars).toBe(400);
    expect(parsed.inputTokens).toBeGreaterThan(0);
    expect(parsed.toolCalls).toBe(1);
  });
});

describe("agent benchmark dry-run", () => {
  it("parses task defs and runs a dry A/B suite with worktrees", async () => {
    const task = parseTaskDef({
      id: "fix-session-redirect",
      repo: "benchmarks/fixtures/session-auth",
      commit: "",
      model: "composer-2.5",
      prompt: "fix it",
      verification: { command: "npm test" },
      runs: 2,
    });
    const outDir = mkdtempSync(join(tmpdir(), "cursory-agent-bench-"));
    try {
      const report = await runAgentBenchmark({
        task,
        dryRun: true,
        outDir,
        runs: 2,
      });
      expect(report.runs).toHaveLength(4);
      expect(report.summary.baseline.runs).toBe(2);
      expect(report.summary.cursory.runs).toBe(2);
      expect(report.summary.change.inputTokensPercent).toBeLessThan(0);
      expect(report.dryRun).toBe(true);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("summarizes success rate and median metrics", () => {
    const mk = (
      variant: "baseline" | "cursory",
      input: number,
      ok: boolean,
    ): AgentRunRecord => ({
      variant,
      index: 1,
      worktree: "/tmp/x",
      timestamp: "2026-09-29T00:00:00.000Z",
      success: ok,
      durationMs: 1000,
      metrics: {
        inputTokens: input,
        outputTokens: 10,
        cacheReadTokens: 100,
        durationMs: 1000,
      },
      metricsSource: "dry-run",
      diff: { filesChanged: 0, insertions: 0, deletions: 0, patch: "" },
      agent: { exitCode: 0, timedOut: false, toolCalls: 0 },
    });
    const summary = buildAgentReportSummary([
      mk("baseline", 100, true),
      mk("baseline", 200, false),
      mk("cursory", 80, true),
      mk("cursory", 90, true),
    ]);
    expect(summary.baseline.successRate).toBe(0.5);
    expect(summary.cursory.successRate).toBe(1);
    expect(summary.baseline.median.inputTokens).toBe(150);
  });
});
