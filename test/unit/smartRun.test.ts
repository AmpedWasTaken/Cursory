import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadRawCombined, loadRawMeta } from "../../src/core/output/rawStore.js";
import { buildGetRaw } from "../../src/mcp/tools/getRaw.js";
import { buildSmartRun, detectMode } from "../../src/mcp/tools/smartRun.js";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "mini-repo");

describe("detectMode", () => {
  it("detects tests and logs", () => {
    expect(detectMode("pnpm test")).toBe("tests");
    expect(detectMode("vitest run")).toBe("tests");
    expect(detectMode("tail -f server.log")).toBe("logs");
    expect(detectMode("next build")).toBe("build");
    expect(detectMode("echo hi")).toBe("raw");
  });
});

describe("cursory_smart_run + get_raw", () => {
  const ids: string[] = [];

  afterEach(() => {
    // raw files expire via TTL; leave on disk for TTL tests / local debug
    ids.length = 0;
  });

  it("stores raw and falls back to baseline text for a small command", async () => {
    const result = await buildSmartRun({
      workspaceRoot: fixtureRoot,
      command: process.platform === "win32" ? "cmd /c echo hello-cursory" : "echo hello-cursory",
      mode: "raw",
      maxTokens: 2000,
      timeoutMs: 15_000,
    });
    ids.push(result.resultId);
    expect(result.resultId).toMatch(/^run_/);
    expect(result.text).not.toContain("raw_result_id:");
    expect(result.text).toContain("hello-cursory");
    expect(result.estimatedDeliveredTokens).toBeLessThanOrEqual(
      result.estimatedRawTokens,
    );
    expect(result.exitCode).toBe(0);

    const meta = loadRawMeta(result.resultId);
    expect(meta).toBeTruthy();
    const combined = loadRawCombined(result.resultId);
    expect(combined).toContain("hello-cursory");

    const expanded = buildGetRaw({
      workspaceRoot: fixtureRoot,
      resultId: result.resultId,
      search: "hello-cursory",
    });
    expect(expanded.found).toBe(true);
    expect(expanded.text).toContain("hello-cursory");
  }, 30_000);

  it("get_raw reports missing ids", () => {
    const expanded = buildGetRaw({
      workspaceRoot: fixtureRoot,
      resultId: "run_missing_deadbeef",
    });
    expect(expanded.found).toBe(false);
    expect(expanded.text).toContain("not found or expired");
  });

  it("rejects cwd outside workspace", async () => {
    await expect(
      buildSmartRun({
        workspaceRoot: fixtureRoot,
        command: "echo no",
        cwd: "..",
      }),
    ).rejects.toThrow(/escapes workspace/);
  });
});
