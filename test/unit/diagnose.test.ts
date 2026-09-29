import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildDiagnose } from "../../src/mcp/tools/diagnose.js";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "mini-repo");

describe("cursory_diagnose", () => {
  it("reports generated dirs and does not claim to modify cursorignore", () => {
    const result = buildDiagnose({ workspaceRoot: fixtureRoot });
    expect(result.text).toContain("Cursory diagnose");
    expect(result.text).toContain("will NOT modify .cursorignore");
    expect(result.findings.some((f) => f.path.includes("node_modules"))).toBe(true);
    expect(result.recommendedIgnores.length).toBeGreaterThanOrEqual(0);
  });
});
