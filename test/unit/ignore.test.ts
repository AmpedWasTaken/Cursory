import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyFile, prefersExactTail } from "../../src/core/indexing/fileClassifier.js";
import { createIgnoreEngine } from "../../src/core/indexing/ignore.js";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "mini-repo");

describe("ignore engine", () => {
  it("ignores default dirs and gitignore / cursorignore patterns", () => {
    const engine = createIgnoreEngine(fixtureRoot);

    expect(engine.ignores(join(fixtureRoot, "node_modules"), true)).toBe(true);
    expect(engine.ignores(join(fixtureRoot, "node_modules", "left-pad", "index.js"), false)).toBe(
      true,
    );
    expect(engine.ignores(join(fixtureRoot, ".next"), true)).toBe(true);
    expect(engine.ignores(join(fixtureRoot, "secret.log"), false)).toBe(true);
    expect(engine.ignores(join(fixtureRoot, "docs"), true)).toBe(true);
    expect(engine.ignores(join(fixtureRoot, "src", "index.ts"), false)).toBe(false);
  });

  it("honors config extra patterns", () => {
    const engine = createIgnoreEngine(fixtureRoot, { extraPatterns: ["src/lib/"] });
    expect(engine.ignores(join(fixtureRoot, "src", "lib"), true)).toBe(true);
    expect(engine.ignores(join(fixtureRoot, "src", "index.ts"), false)).toBe(false);
  });
});

describe("file classifier tails", () => {
  it("classifies logs for exact tails and leaves source heads alone", () => {
    expect(prefersExactTail("tmp/app.log")).toBe(true);
    expect(classifyFile("tmp/app.log").kind).toBe("log");
    expect(prefersExactTail("src/logs/logger.ts")).toBe(false);
    expect(classifyFile("src/debug.ts").kind).toBe("source");
    expect(prefersExactTail("src/lib/PaymentService.ts")).toBe(false);
  });

  it("classifies Dart files as source so search indexes them", () => {
    expect(classifyFile("lib/features/game/hangman_board.dart")).toEqual({
      kind: "source",
      language: "Dart",
    });
  });
});
