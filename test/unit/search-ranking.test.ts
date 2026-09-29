import { describe, expect, it } from "vitest";
import { analyzeQuery } from "../../src/core/search/queryAnalysis.js";
import {
  DEFAULT_RANKING_WEIGHTS,
  normalizeScores,
  scoreCandidate,
} from "../../src/core/search/ranking.js";

describe("query analysis", () => {
  it("extracts path and symbol hints", () => {
    const q = analyzeQuery("where is PaymentService.processPayment in src/lib/PaymentService.ts");
    expect(q.symbolHints).toEqual(expect.arrayContaining(["PaymentService"]));
    expect(q.pathHints.some((p) => p.includes("PaymentService.ts"))).toBe(true);
    expect(q.textTerms.length).toBeGreaterThan(0);
  });
});

describe("ranking", () => {
  it("scores with configurable weights and normalizes", () => {
    const a = scoreCandidate(
      {
        exactSymbol: true,
        exactFilename: false,
        changedFile: true,
        gitRecent: false,
        pathKeywordScore: 0.5,
        textDensityScore: 0.2,
        importRelationship: false,
      },
      DEFAULT_RANKING_WEIGHTS,
    );
    expect(a.score).toBeGreaterThan(1);
    expect(a.breakdown.exactSymbol).toBe(1);

    const ranked = normalizeScores([
      { score: a.score, id: "a" },
      { score: a.score / 2, id: "b" },
    ]);
    expect(ranked[0]!.score).toBe(1);
    expect(ranked[1]!.score).toBe(0.5);
  });
});
