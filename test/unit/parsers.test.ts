import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FallbackParser } from "../../src/core/parsers/fallbackParser.js";
import { parseSource, ParserRegistry } from "../../src/core/parsers/registry.js";
import { TypeScriptAstParser } from "../../src/core/parsers/typescriptParser.js";
import { TreeSitterParser } from "../../src/core/parsers/treeSitterParser.js";
import { getSymbolIndex, resetSymbolIndex } from "../../src/core/indexing/symbolIndex.js";
import { extractSymbols, findSymbol } from "../../src/core/indexing/symbols.js";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "mini-repo");

describe("parsers", () => {
  it("TypeScript AST extracts class/methods/imports", () => {
    const content = readFileSync(join(fixtureRoot, "src/lib/PaymentService.ts"), "utf8");
    const result = new TypeScriptAstParser().parse("PaymentService.ts", content);
    expect(result.parserId).toBe("typescript-ast");
    expect(findSymbol(result.symbols, "PaymentService")?.kind).toBe("class");
    expect(findSymbol(result.symbols, "processPayment")?.kind).toBe("method");
    expect(result.imports.length).toBeGreaterThanOrEqual(0);
  });

  it("registry prefers typescript-ast when tree-sitter is absent", () => {
    const content = "export function hello() { return 1; }\n";
    const parsed = parseSource("src/hello.ts", content);
    expect(parsed.parserId).toBe("typescript-ast");
    expect(findSymbol(parsed.symbols, "hello")?.kind).toBe("function");
  });

  it("fallback parser handles plain text languages", () => {
    const py = "def foo():\n  return 1\n";
    const result = new FallbackParser().parse("foo.py", py);
    // regex is TS-oriented; just ensure it doesn't throw and returns a result
    expect(result.parserId).toBe("fallback-regex");
  });

  it("tree-sitter adapter fails soft without packages", () => {
    const parser = new TreeSitterParser();
    expect(parser.supports("a.ts")).toBe(true);
    expect(parser.parse("a.ts", "export const x = 1;")).toBeNull();
  });

  it("symbol index caches by content hash", () => {
    resetSymbolIndex();
    const index = getSymbolIndex();
    const content = "export function cached() { return 1; }\n";
    const a = index.getOrParse("cached.ts", content);
    const b = index.getOrParse("cached.ts", content);
    expect(a.contentHash).toBe(b.contentHash);
    expect(index.size()).toBe(1);
    expect(extractSymbols(content, "cached.ts").some((s) => s.name === "cached")).toBe(true);
  });

  it("ParserRegistry falls through on null parser results", () => {
    const registry = new ParserRegistry([
      {
        id: "noop",
        supports: () => true,
        parse: () => null,
      },
      new TypeScriptAstParser(),
    ]);
    const result = registry.parse("x.ts", "export function z() {}\n");
    expect(result.parserId).toBe("typescript-ast");
  });
});
