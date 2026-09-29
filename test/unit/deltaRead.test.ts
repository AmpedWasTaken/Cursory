import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { resetSessionContentCache } from "../../src/core/cache/sessionCache.js";
import { buildSmartRead } from "../../src/mcp/tools/smartRead.js";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "mini-repo");
const target = join(fixtureRoot, "src", "lib", "delta-demo.ts");

describe("delta smart_read", () => {
  beforeEach(() => {
    resetSessionContentCache();
    const filler = Array.from({ length: 80 }, (_, i) => `  // filler line ${i}`).join("\n");
    writeFileSync(
      target,
      [
        "export function alpha() {",
        "  return 1;",
        "}",
        "",
        filler,
        "",
        "export function beta() {",
        "  return 2;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
  });

  it("returns a delta when file content changes after a prior read", () => {
    const first = buildSmartRead({
      workspaceRoot: fixtureRoot,
      path: "src/lib/delta-demo.ts",
      forceFull: true,
    });
    expect(first.delta).toBe(false);
    expect(first.text).toContain("alpha");

    const filler = Array.from({ length: 80 }, (_, i) => `  // filler line ${i}`).join("\n");
    writeFileSync(
      target,
      [
        "export function alpha() {",
        "  return 1;",
        "}",
        "",
        filler,
        "",
        "export function beta() {",
        "  return 99; // changed",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const second = buildSmartRead({
      workspaceRoot: fixtureRoot,
      path: "src/lib/delta-demo.ts",
    });
    expect(second.delta).toBe(true);
    expect(second.text).toContain("[delta]");
    expect(second.text).toContain("unified diff");
    expect(second.text).toMatch(/return 99/);
    expect(second.estimatedDeliveredTokens).toBeLessThan(first.estimatedDeliveredTokens);
    expect(second.estimatedDeliveredTokens).toBeLessThan(first.estimatedRawTokens * 0.5);
  });
});
