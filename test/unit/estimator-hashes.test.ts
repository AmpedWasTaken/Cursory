import { describe, expect, it } from "vitest";
import { hashBuffer, hashString } from "../../src/core/cache/hashes.js";
import { estimateTokensFromBytes, estimateTokensFromText } from "../../src/core/telemetry/estimator.js";

describe("hashes", () => {
  it("hashes strings deterministically with sha256 hex", () => {
    expect(hashString("cursory")).toBe(hashString("cursory"));
    expect(hashString("a")).not.toBe(hashString("b"));
    expect(hashString("cursory")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("hashes buffers", () => {
    expect(hashBuffer(Buffer.from("abc"))).toBe(hashString("abc"));
  });
});

describe("estimator", () => {
  it("estimates tokens from text via char heuristic", () => {
    const empty = estimateTokensFromText("");
    expect(empty.tokens).toBe(0);
    expect(empty.method).toBe("chars");

    const four = estimateTokensFromText("abcd");
    expect(four.tokens).toBe(1);

    const longer = estimateTokensFromText("a".repeat(40));
    expect(longer.tokens).toBe(10);
  });

  it("estimates from byte length", () => {
    expect(estimateTokensFromBytes(0).tokens).toBe(0);
    expect(estimateTokensFromBytes(8).tokens).toBe(2);
  });
});
