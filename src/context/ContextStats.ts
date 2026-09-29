export interface OptimizationStats {
  baselineTokens: number;
  optimizedTokens: number;
  tokensSaved: number;
  reductionPercent: number;
  skippedDuplicateTokens: number;
  skippedIrrelevantTokens: number;
  compressedTokens: number;
  regressionTokens: number;
}

export function calculateOptimizationStats(input: {
  baselineTokens: number;
  optimizedTokens: number;
  skippedDuplicateTokens?: number;
  skippedIrrelevantTokens?: number;
  compressedTokens?: number;
}): OptimizationStats {
  const baselineTokens = Math.max(0, input.baselineTokens);
  const optimizedTokens = Math.max(0, input.optimizedTokens);
  const tokensSaved = Math.max(0, baselineTokens - optimizedTokens);
  return {
    baselineTokens,
    optimizedTokens,
    tokensSaved,
    reductionPercent:
      baselineTokens === 0 ? 0 : (tokensSaved / baselineTokens) * 100,
    skippedDuplicateTokens: Math.max(
      0,
      input.skippedDuplicateTokens ?? 0,
    ),
    skippedIrrelevantTokens: Math.max(
      0,
      input.skippedIrrelevantTokens ?? 0,
    ),
    compressedTokens: Math.max(0, input.compressedTokens ?? 0),
    regressionTokens: Math.max(0, optimizedTokens - baselineTokens),
  };
}
