import { describe, expect, it } from "vitest";
import { getCapLimits } from "../../src/hooks/capLimits.js";
import {
  boundDumpCommand,
  boundNoisyShellCommand,
  normalizeToolName,
  optimizeNativeTool,
} from "../../src/hooks/nativeTakeover.js";

const balanced = getCapLimits("balanced");

function stat(size: number) {
  return { statSync: () => ({ size }), limits: balanced };
}

describe("native takeover", () => {
  it("does not emit conversation-appending hook fields", () => {
    const out = optimizeNativeTool(
      {
        tool_name: "Read",
        tool_input: { path: "src/big.ts" },
        cwd: "/repo",
      },
      stat(balanced.smallFileBytes + 1),
    );
    expect(Object.keys(out).sort()).toEqual(
      ["permission", "updated_input"].sort(),
    );
    expect(out).not.toHaveProperty("additional_context");
    expect(out).not.toHaveProperty("agent_message");
  });

  it("leaves tiny native reads alone", () => {
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

  it("caps unbounded medium/large reads", () => {
    const out = optimizeNativeTool(
      {
        tool_name: "Read",
        tool_input: { path: "src/TokenManager.ts" },
        cwd: "/repo",
      },
      stat(balanced.smallFileBytes + 1),
    );
    expect(out.permission).toBe("allow");
    expect(out.updated_input).toMatchObject({
      path: "src/TokenManager.ts",
      limit: balanced.readLineLimit,
    });
  });

  it("clamps an oversized explicit read limit on large files", () => {
    const out = optimizeNativeTool(
      {
        tool_name: "Read",
        tool_input: {
          path: "src/TokenManager.ts",
          offset: 1,
          limit: 5_000,
        },
        cwd: "/repo",
      },
      stat(balanced.smallFileBytes + 1),
    );
    expect(out.updated_input).toMatchObject({
      limit: balanced.readLineLimit,
    });
  });

  it("does not override a modest explicit read limit", () => {
    const out = optimizeNativeTool(
      {
        tool_name: "Read",
        tool_input: {
          path: "src/TokenManager.ts",
          offset: 400,
          limit: 40,
        },
        cwd: "/repo",
      },
      stat(balanced.smallFileBytes + 1),
    );
    expect(out).toEqual({ permission: "allow" });
  });

  it("caps grep floods and clamps context", () => {
    const capped = optimizeNativeTool(
      {
        tool_name: "Grep",
        tool_input: {
          pattern: "refreshToken",
          outputMode: "content",
          context: 8,
        },
      },
      { statSync: () => ({ size: 0 }), limits: balanced },
    );
    expect(capped.updated_input).toMatchObject({
      headLimit: balanced.grepHeadLimit,
      context: balanced.grepContextMax,
    });

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

  it("bounds file dumps and noisy exploration shells", () => {
    const bounded = boundDumpCommand(
      "cat src/lib/auth/TokenManager.ts",
      balanced.shellLineLimit,
    );
    expect(bounded).toMatch(String(balanced.shellLineLimit));
    expect(boundDumpCommand("cat src/file.ts | rg foo")).toBeUndefined();
    expect(boundDumpCommand("npm test")).toBeUndefined();

    const git = boundNoisyShellCommand("git diff", balanced.shellLineLimit);
    expect(git).toMatch(/git --no-pager diff/);
    expect(git).toMatch(/head -n|Select-Object -First/);

    const log = boundNoisyShellCommand(
      "git log --oneline",
      balanced.shellLineLimit,
    );
    expect(log).toMatch(/git --no-pager log -n 20/);

    // Never wrap test runners — exit codes must stay real.
    expect(
      boundNoisyShellCommand("npm test", balanced.shellLineLimit),
    ).toBeUndefined();

    expect(normalizeToolName("readToolCall")).toBe("read");
    expect(normalizeToolName("Ripgrep Raw Search")).toBe("grep");
    expect(normalizeToolName("Glob")).toBe("glob");
  });

  it("tails unbounded log reads", () => {
    const out = optimizeNativeTool(
      {
        tool_name: "Read",
        tool_input: { path: "tmp/app.log" },
        cwd: "/repo",
      },
      stat(balanced.smallFileBytes + 1),
    );
    expect(out.updated_input).toMatchObject({
      path: "tmp/app.log",
      offset: -balanced.readLineLimit,
      limit: balanced.readLineLimit,
    });
  });

  it("caps unbounded Ripgrep the same as Grep", () => {
    const capped = optimizeNativeTool(
      {
        tool_name: "Ripgrep Raw Search",
        tool_input: { pattern: "refreshToken", outputMode: "content" },
      },
      { statSync: () => ({ size: 0 }), limits: balanced },
    );
    expect(capped.updated_input).toMatchObject({
      headLimit: balanced.grepHeadLimit,
    });
  });

  it("adds a head_limit to unbounded Glob", () => {
    const out = optimizeNativeTool(
      {
        tool_name: "Glob",
        tool_input: { glob_pattern: "**/*" },
      },
      { statSync: () => ({ size: 0 }), limits: balanced },
    );
    expect(out.updated_input).toMatchObject({ head_limit: 30 });
  });
});
