import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { estimateTokens } from "../../src/context/TokenEstimator.js";

interface HookCommand {
  command: string;
  matcher?: string;
}

interface HookManifest {
  hooks: Record<string, HookCommand[]>;
}

function manifest(): HookManifest {
  return JSON.parse(
    readFileSync(join(process.cwd(), "hooks/hooks.json"), "utf8"),
  ) as HookManifest;
}

describe("hook registration context regression", () => {
  it("does not register hooks that append conversation text", () => {
    const hooks = manifest().hooks;
    expect(hooks.sessionStart).toBeUndefined();
    expect(hooks.beforeShellExecution).toBeUndefined();
    expect(hooks.preToolUse).toHaveLength(1);
    expect(hooks.preToolUse?.[0]?.command).toContain("pre-tool-use");
    expect(hooks.preToolUse?.[0]?.matcher).toBeUndefined();
    const takeover = readFileSync(join(process.cwd(), "src/hooks/nativeTakeover.ts"), "utf8");
    const preTool = readFileSync(join(process.cwd(), "src/hooks/pre-tool-use.ts"), "utf8");
    for (const source of [takeover, preTool]) {
      expect(source).not.toMatch(/additional_context|agent_message|user_message/);
    }
  });

  it("registers every remaining handler once across submissions and reloads", () => {
    const commands = Object.values(manifest().hooks)
      .flat()
      .map((hook) => hook.command);
    expect(new Set(commands).size).toBe(commands.length);
    expect(commands.filter((command) => command.includes("pre-tool-use"))).toHaveLength(1);
    expect(commands.filter((command) => command.includes("post-tool-use"))).toHaveLength(1);
    expect(commands.filter((command) => command.includes("pre-compact"))).toHaveLength(1);
  });

  it("keeps always-on Cursory guidance below 150 tokens", () => {
    const rule = readFileSync(
      join(process.cwd(), "rules/cursory.mdc"),
      "utf8",
    ).replace(/^---[\s\S]*?---\s*/, "");
    expect(estimateTokens(rule)).toBeLessThan(150);
  });

  it("keeps the efficient-context skill too small to be worth reading", () => {
    const skill = readFileSync(
      join(process.cwd(), "skills/efficient-context/SKILL.md"),
      "utf8",
    );
    expect(skill).toMatch(/Do not (open|read)/i);
    expect(estimateTokens(skill)).toBeLessThan(80);
  });
});
