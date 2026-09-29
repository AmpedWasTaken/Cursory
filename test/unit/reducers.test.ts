import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { reduceLogs } from "../../src/core/output/logReducer.js";
import { reduceTests } from "../../src/core/output/testReducer.js";
import { reduceTerminal } from "../../src/core/output/terminalReducer.js";
import { redactSecrets } from "../../src/core/output/secretRedaction.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "terminal");

describe("reducers", () => {
  it("reduceTests keeps failures and suppresses pass noise", () => {
    const stdout = readFileSync(join(fixtureDir, "vitest-large.txt"), "utf8");
    const result = reduceTests({
      stdout,
      stderr: "",
      exitCode: 1,
      timedOut: false,
      command: "pnpm test",
      maxTokens: 4000,
    });
    expect(result.rawLines).toBeGreaterThan(300);
    expect(result.text).toContain("Expected 200");
    expect(result.text).toContain("Received 401");
    expect(result.text).toContain("refreshToken");
    expect(result.text).toMatch(/suppressed_passing_lines/);
    expect(result.text).not.toMatch(/PASS test\/unit\/pass299/);
    expect(result.keptLines).toBeLessThan(result.rawLines);
  });

  it("reduceLogs collapses repeats and keeps errors", () => {
    const stdout = readFileSync(join(fixtureDir, "server.log"), "utf8");
    const result = reduceLogs({
      stdout,
      stderr: "",
      exitCode: 0,
      timedOut: false,
      command: "type server.log",
      maxTokens: 3000,
    });
    expect(result.text).toContain("repeated messages");
    expect(result.text).toContain("exception in refreshToken");
    expect(result.text).toMatch(/\d+×/);
  });

  it("reduceTerminal drops progress-like lines", () => {
    const result = reduceTerminal({
      stdout: ["download 10%", "download 20%", "ERROR boom", "at foo (x:1:1)"].join("\n"),
      stderr: "",
      exitCode: 1,
      timedOut: false,
      command: "build",
      maxTokens: 1000,
    });
    expect(result.text).toContain("ERROR boom");
    expect(result.text).not.toContain("download 10%");
  });

  it("redacts bearer tokens in summaries", () => {
    expect(redactSecrets("Authorization: Bearer abcdef123456")).toContain("***");
  });
});
