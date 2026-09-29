import { describe, expect, it } from "vitest";
import {
  liveEvalEventFromHook,
  parseLiveEvalLines,
  summarizeLiveEval,
} from "../../src/core/telemetry/liveEval.js";

describe("live eval", () => {
  it("flags offset follow-ups on the same path as retry tax", () => {
    const events = parseLiveEvalLines(
      [
        JSON.stringify(
          liveEvalEventFromHook(
            { tool_name: "Read", tool_input: { path: "src/big.ts" } },
            { updated_input: { path: "src/big.ts", limit: 200 } },
            true,
          ),
        ),
        JSON.stringify({
          ts: "2026-09-25T00:00:00.000Z",
          tool: "Read",
          capped: false,
          applied: false,
          path: "src/big.ts",
          offset: 201,
          limit: 200,
        }),
        JSON.stringify(
          liveEvalEventFromHook(
            { tool_name: "MCP:cursory_smart_read", tool_input: { path: "src/big.ts" } },
            {},
            false,
          ),
        ),
      ].join("\n"),
    );
    const summary = summarizeLiveEval(events);
    expect(summary.total).toBe(3);
    expect(summary.capped).toBe(1);
    expect(summary.applied).toBe(1);
    expect(summary.reads).toBe(2);
    expect(summary.mcp).toBe(1);
    expect(summary.offsetFollowups).toBe(1);
  });
});
