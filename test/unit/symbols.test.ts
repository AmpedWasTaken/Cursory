import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractSymbols, findSymbol } from "../../src/core/indexing/symbols.js";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "mini-repo");

describe("fallback symbol extraction", () => {
  it("finds class and methods in PaymentService", () => {
    const content = readFileSync(join(fixtureRoot, "src/lib/PaymentService.ts"), "utf8");
    const symbols = extractSymbols(content);
    expect(findSymbol(symbols, "PaymentService")?.kind).toBe("class");
    expect(findSymbol(symbols, "processPayment")).toBeTruthy();
    expect(findSymbol(symbols, "checkout")?.kind).toBe("function");
  });
});
