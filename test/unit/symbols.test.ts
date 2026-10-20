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

  it("ends a long Dart class at its closing brace", () => {
    const body = Array.from({ length: 600 }, (_, i) => `  int field${i} = ${i};`);
    const content = ["class LongCubit extends Cubit<int> {", ...body, "}", ""].join("\n");
    const found = findSymbol(extractSymbols(content, "lib/long_cubit.dart"), "LongCubit");
    expect(found?.startLine).toBe(1);
    expect(found?.endLine).toBe(602);
  });
});
