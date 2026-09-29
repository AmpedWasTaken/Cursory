export interface RankingWeights {
  exactSymbol: number;
  exactFilename: number;
  changedFile: number;
  gitRecent: number;
  pathKeyword: number;
  textDensity: number;
  importRelationship: number;
}

export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  exactSymbol: 1.0,
  exactFilename: 0.9,
  changedFile: 0.3,
  gitRecent: 0.15,
  pathKeyword: 0.25,
  textDensity: 0.3,
  importRelationship: 0.2,
};

export interface RankingSignals {
  exactSymbol: boolean;
  exactFilename: boolean;
  changedFile: boolean;
  gitRecent: boolean;
  pathKeywordScore: number; // 0..1
  textDensityScore: number; // 0..1
  importRelationship: boolean;
}

export interface RankedScore {
  score: number;
  signals: RankingSignals;
  breakdown: Partial<Record<keyof RankingWeights, number>>;
}

export function scoreCandidate(
  signals: RankingSignals,
  weights: RankingWeights = DEFAULT_RANKING_WEIGHTS,
): RankedScore {
  const breakdown: Partial<Record<keyof RankingWeights, number>> = {};
  let score = 0;

  if (signals.exactSymbol) {
    breakdown.exactSymbol = weights.exactSymbol;
    score += weights.exactSymbol;
  }
  if (signals.exactFilename) {
    breakdown.exactFilename = weights.exactFilename;
    score += weights.exactFilename;
  }
  if (signals.changedFile) {
    breakdown.changedFile = weights.changedFile;
    score += weights.changedFile;
  }
  if (signals.gitRecent) {
    breakdown.gitRecent = weights.gitRecent;
    score += weights.gitRecent;
  }
  if (signals.pathKeywordScore > 0) {
    breakdown.pathKeyword = weights.pathKeyword * clamp01(signals.pathKeywordScore);
    score += breakdown.pathKeyword;
  }
  if (signals.textDensityScore > 0) {
    breakdown.textDensity = weights.textDensity * clamp01(signals.textDensityScore);
    score += breakdown.textDensity;
  }
  if (signals.importRelationship) {
    breakdown.importRelationship = weights.importRelationship;
    score += weights.importRelationship;
  }

  return { score, signals, breakdown };
}

/** Normalize scores into 0..1 relative to the top hit. */
export function normalizeScores<T extends { score: number }>(items: T[]): (T & { score: number })[] {
  if (items.length === 0) return items;
  const max = Math.max(...items.map((i) => i.score), 0.0001);
  return items.map((i) => ({ ...i, score: Math.round((i.score / max) * 1000) / 1000 }));
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
