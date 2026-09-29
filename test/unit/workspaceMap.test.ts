import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createIgnoreEngine } from "../../src/core/indexing/ignore.js";
import { scanWorkspace } from "../../src/core/indexing/workspaceIndex.js";
import { buildWorkspaceMap } from "../../src/mcp/tools/workspaceMap.js";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "mini-repo");

describe("workspace scanner", () => {
  it("indexes source files and skips node_modules / .next", () => {
    const scan = scanWorkspace(fixtureRoot, {
      ignore: createIgnoreEngine(fixtureRoot),
    });
    const paths = scan.files.map((f) => f.relativePath);
    expect(paths).toContain("src/index.ts");
    expect(paths).toContain("src/app/page.tsx");
    expect(paths).toContain("package.json");
    expect(paths.some((p) => p.startsWith("node_modules"))).toBe(false);
    expect(paths.some((p) => p.startsWith(".next"))).toBe(false);
    // docs ignored via .cursorignore
    expect(paths.some((p) => p.startsWith("docs/"))).toBe(false);
    expect(scan.frameworks).toEqual(expect.arrayContaining(["Next.js", "React"]));
    expect(scan.languageCounts.TypeScript).toBeGreaterThan(0);
    expect(scan.largeIgnoredDirs.some((d) => d.relativePath.startsWith("node_modules"))).toBe(true);
  });
});

describe("cursory_workspace_map", () => {
  it("never returns more context than the observed path baseline", () => {
    const result = buildWorkspaceMap({ workspaceRoot: fixtureRoot, maxTokens: 2000 });
    expect(result.text).toContain("src/lib/PaymentService.ts");
    expect(result.text).not.toContain("node_modules/left-pad/index.js");
    expect(result.estimatedDeliveredTokens).toBeLessThanOrEqual(result.estimatedRawTokens);
    expect(result.estimatedDeliveredTokens).toBeLessThanOrEqual(2000);
    expect(result.scan.indexedCount).toBeGreaterThan(0);
  }, 20_000);
});
