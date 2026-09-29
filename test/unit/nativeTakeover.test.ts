import { describe, expect, it } from "vitest";
import {
  GREP_HEAD_LIMIT,
  READ_LINE_LIMIT,
  SMALL_FILE_BYTES,
  boundDumpCommand,
  normalizeToolName,
  optimizeNativeTool,
} from "../../src/hooks/nativeTakeover.js";

function stat(size: number) {
  return { statSync: () => ({ size }) };
}

describe("native takeover", () => {
  it("does not emit conversation-appending hook fields", () => {
    const out = optimizeNativeTool(
      {
        tool_name: "Read",
        tool_input: { path: "src/big.ts" },
        cwd: "/repo",
      },
      stat(SMALL_FILE_BYTES + 1),
    );
    expect(Object.keys(out).sort()).toEqual(["permission", "updated_input"].sort());
    expect(out).not.toHaveProperty("additional_context");
    expect(out).not.toHaveProperty("agent_message");
    expect(out).not.toHaveProperty("user_message");
  });

  it("leaves small native reads alone", () => {
    const out = optimizeNativeTool(
      {
        tool_name: "Read",
        tool_input: { path: "src/tiny.ts" },
        cwd: "/repo",
      },
      stat(100),
    );
    expect(out).toEqual({ permission: "allow" });
  });

  it("caps unbounded large reads without denying them", () => {
    const out = optimizeNativeTool(
      {
        tool_name: "Read",
        tool_input: { path: "src/TokenManager.ts" },
        cwd: "/repo",
      },
      stat(154_060),
    );
    expect(out.permission).toBe("allow");
    expect(out.updated_input).toMatchObject({
      path: "src/TokenManager.ts",
      limit: READ_LINE_LIMIT,
    });
  });

  it("does not override an explicit read limit", () => {
    const out = optimizeNativeTool(
      {
        tool_name: "Read",
        tool_input: { path: "src/TokenManager.ts", offset: 400, limit: 40 },
        cwd: "/repo",
      },
      stat(154_060),
    );
    expect(out).toEqual({ permission: "allow" });
  });

  it("caps unbounded grep floods and leaves count mode alone", () => {
    const capped = optimizeNativeTool({
      tool_name: "Grep",
      tool_input: { pattern: "refreshToken", outputMode: "content", context: 3 },
    });
    expect(capped.updated_input).toMatchObject({ headLimit: GREP_HEAD_LIMIT });

    const counted = optimizeNativeTool({
      tool_name: "Grep",
      tool_input: { pattern: "refreshToken", outputMode: "count" },
    });
    expect(counted).toEqual({ permission: "allow" });
  });

  it("does not rewrite MCP or unknown tools", () => {
    expect(
      optimizeNativeTool({
        tool_name: "MCP:cursory_smart_read",
        tool_input: { path: "src/lib.ts" },
      }),
    ).toEqual({ permission: "allow" });
    expect(
      optimizeNativeTool({
        tool_name: "Write",
        tool_input: { path: "src/lib.ts", contents: "x" },
      }),
    ).toEqual({ permission: "allow" });
  });

  it("bounds obvious file-dump shell commands and skips pipelines", () => {
    const bounded = boundDumpCommand("cat src/lib/auth/TokenManager.ts");
    expect(bounded).toMatch(/200/);
    expect(boundDumpCommand("cat src/file.ts | rg foo")).toBeUndefined();
    expect(boundDumpCommand("npm test")).toBeUndefined();
    expect(normalizeToolName("readToolCall")).toBe("read");
    expect(normalizeToolName("Ripgrep Raw Search")).toBe("grep");
    expect(normalizeToolName("Read File V2")).toBe("read");
  });

  it("tails unbounded log reads and log file dumps", () => {
    const out = optimizeNativeTool(
      {
        tool_name: "Read",
        tool_input: { path: "tmp/app.log" },
        cwd: "/repo",
      },
      stat(SMALL_FILE_BYTES + 1),
    );
    expect(out.updated_input).toMatchObject({
      path: "tmp/app.log",
      offset: -READ_LINE_LIMIT,
      limit: READ_LINE_LIMIT,
    });

    const dump = boundDumpCommand("cat tmp/app.log");
    expect(dump).toMatch(/-Tail|tail -n/);
    expect(boundDumpCommand("cat src/file.ts")).not.toMatch(/-Tail|tail -n/);
  });

  it("caps unbounded Ripgrep the same as Grep", () => {
    const capped = optimizeNativeTool({
      tool_name: "Ripgrep Raw Search",
      tool_input: { pattern: "refreshToken", outputMode: "content" },
    });
    expect(capped.updated_input).toMatchObject({ headLimit: GREP_HEAD_LIMIT });
  });
});
