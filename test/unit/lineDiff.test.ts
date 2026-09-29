import { describe, expect, it } from "vitest";
import { surroundingFromHunks, unifiedLineDiff } from "../../src/core/output/lineDiff.js";

describe("unifiedLineDiff", () => {
  it("produces a compact patch for a small edit", () => {
    const oldText = ["a", "b", "c", "d", "e"].join("\n");
    const newText = ["a", "b", "X", "d", "e"].join("\n");
    const { text, changedLines, hunks } = unifiedLineDiff(oldText, newText, 1);
    expect(changedLines).toBeGreaterThanOrEqual(2);
    expect(text).toContain("-c");
    expect(text).toContain("+X");
    expect(hunks.length).toBeGreaterThan(0);
    const surrounding = surroundingFromHunks(newText, hunks, 1);
    expect(surrounding).toContain("|X");
  });

  it("handles pure additions", () => {
    const { text } = unifiedLineDiff("a\n", "a\nb\n", 1);
    expect(text).toContain("+b");
  });
});
