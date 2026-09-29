import { describe, expect, it } from "vitest";
import { buildPingResult, formatPingText } from "../../src/mcp/tools/ping.js";

describe("cursory_ping", () => {
  it("returns ok diagnostic payload", () => {
    const result = buildPingResult();
    expect(result.ok).toBe(true);
    expect(result.name).toBe("cursory");
    expect(result.phase).toBe(9);
    expect(result.message).toContain("Phase 9");
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("formats a compact human-readable text block", () => {
    const text = formatPingText(buildPingResult());
    expect(text).toContain("Cursory ping:");
    expect(text).toContain("name=cursory");
    expect(text).toContain("phase=9");
  });
});
