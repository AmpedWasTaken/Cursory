import type { BenchmarkSummary } from "./liveRunSchema.js";

export interface BarChartSpec {
  title: string;
  subtitle: string;
  unit: string;
  baseline: number;
  cursory: number;
  baselineMin: number;
  baselineMax: number;
  cursoryMin: number;
  cursoryMax: number;
  changePercent: number;
  baselineRuns: number;
  cursoryRuns: number;
}

const BASELINE_FILL = "#64748b";
const CURSORY_FILL = "#0d9488";
const AXIS = "#94a3b8";
const TEXT = "#0f172a";
const MUTED = "#64748b";
const GRID = "#e2e8f0";
const BG = "#ffffff";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatValue(n: number, unit: string): string {
  if (unit === "ms") {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}s`;
    return `${Math.round(n)}ms`;
  }
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 1 : 2)}k`;
  return String(Math.round(n));
}

function formatChange(pct: number): string {
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export function renderComparisonBarSvg(spec: BarChartSpec): string {
  const width = 720;
  const height = 320;
  const padL = 64;
  const padR = 32;
  const padT = 56;
  const padB = 72;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;
  const maxVal = Math.max(
    spec.baselineMax,
    spec.cursoryMax,
    spec.baseline,
    spec.cursory,
    1,
  );
  const yScale = (v: number) => padT + chartH - (v / maxVal) * chartH;

  const barW = 96;
  const gap = 120;
  const groupW = barW * 2 + gap;
  const groupX = padL + (chartW - groupW) / 2;
  const baseX = groupX;
  const cursoryX = groupX + barW + gap;

  const baseY = yScale(spec.baseline);
  const cursoryY = yScale(spec.cursory);
  const baseH = padT + chartH - baseY;
  const cursoryH = padT + chartH - cursoryY;

  const changeColor =
    spec.changePercent < 0
      ? "#059669"
      : spec.changePercent > 0
        ? "#dc2626"
        : MUTED;

  const gridLines = [0.25, 0.5, 0.75, 1]
    .map((f) => {
      const y = yScale(maxVal * f);
      const label = formatValue(maxVal * f, spec.unit);
      return [
        `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`,
        `<text x="${padL - 10}" y="${y + 4}" text-anchor="end" font-size="11" fill="${MUTED}" font-family="ui-sans-serif, system-ui, sans-serif">${escapeXml(label)}</text>`,
      ].join("\n");
    })
    .join("\n");

  const whisker = (
    x: number,
    min: number,
    max: number,
    color: string,
  ): string => {
    const yMin = yScale(min);
    const yMax = yScale(max);
    const cx = x + barW / 2;
    return [
      `<line x1="${cx}" y1="${yMax}" x2="${cx}" y2="${yMin}" stroke="${color}" stroke-width="2" opacity="0.55"/>`,
      `<line x1="${cx - 10}" y1="${yMax}" x2="${cx + 10}" y2="${yMax}" stroke="${color}" stroke-width="2" opacity="0.55"/>`,
      `<line x1="${cx - 10}" y1="${yMin}" x2="${cx + 10}" y2="${yMin}" stroke="${color}" stroke-width="2" opacity="0.55"/>`,
    ].join("\n");
  };

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(spec.title)}">
  <rect width="100%" height="100%" fill="${BG}"/>
  <text x="${padL}" y="28" font-size="18" font-weight="700" fill="${TEXT}" font-family="ui-sans-serif, system-ui, sans-serif">${escapeXml(spec.title)}</text>
  <text x="${padL}" y="46" font-size="12" fill="${MUTED}" font-family="ui-sans-serif, system-ui, sans-serif">${escapeXml(spec.subtitle)}</text>
  <text x="${width - padR}" y="28" text-anchor="end" font-size="14" font-weight="700" fill="${changeColor}" font-family="ui-sans-serif, system-ui, sans-serif">${escapeXml(formatChange(spec.changePercent))}</text>
  <text x="${width - padR}" y="46" text-anchor="end" font-size="11" fill="${MUTED}" font-family="ui-sans-serif, system-ui, sans-serif">vs baseline avg</text>
  ${gridLines}
  <line x1="${padL}" y1="${padT + chartH}" x2="${width - padR}" y2="${padT + chartH}" stroke="${AXIS}" stroke-width="1.5"/>
  <rect x="${baseX}" y="${baseY}" width="${barW}" height="${baseH}" rx="6" fill="${BASELINE_FILL}"/>
  <rect x="${cursoryX}" y="${cursoryY}" width="${barW}" height="${cursoryH}" rx="6" fill="${CURSORY_FILL}"/>
  ${whisker(baseX, spec.baselineMin, spec.baselineMax, BASELINE_FILL)}
  ${whisker(cursoryX, spec.cursoryMin, spec.cursoryMax, CURSORY_FILL)}
  <text x="${baseX + barW / 2}" y="${baseY - 8}" text-anchor="middle" font-size="13" font-weight="600" fill="${TEXT}" font-family="ui-sans-serif, system-ui, sans-serif">${escapeXml(formatValue(spec.baseline, spec.unit))}</text>
  <text x="${cursoryX + barW / 2}" y="${cursoryY - 8}" text-anchor="middle" font-size="13" font-weight="600" fill="${TEXT}" font-family="ui-sans-serif, system-ui, sans-serif">${escapeXml(formatValue(spec.cursory, spec.unit))}</text>
  <text x="${baseX + barW / 2}" y="${padT + chartH + 22}" text-anchor="middle" font-size="13" font-weight="600" fill="${TEXT}" font-family="ui-sans-serif, system-ui, sans-serif">Baseline</text>
  <text x="${baseX + barW / 2}" y="${padT + chartH + 40}" text-anchor="middle" font-size="11" fill="${MUTED}" font-family="ui-sans-serif, system-ui, sans-serif">n=${spec.baselineRuns}</text>
  <text x="${cursoryX + barW / 2}" y="${padT + chartH + 22}" text-anchor="middle" font-size="13" font-weight="600" fill="${TEXT}" font-family="ui-sans-serif, system-ui, sans-serif">Cursory</text>
  <text x="${cursoryX + barW / 2}" y="${padT + chartH + 40}" text-anchor="middle" font-size="11" fill="${MUTED}" font-family="ui-sans-serif, system-ui, sans-serif">n=${spec.cursoryRuns}</text>
  <text x="${width / 2}" y="${height - 12}" text-anchor="middle" font-size="11" fill="${MUTED}" font-family="ui-sans-serif, system-ui, sans-serif">Bars = mean · whiskers = min–max across runs</text>
</svg>
`;
}

export function chartSpecsForSummary(
  summary: BenchmarkSummary,
): Record<"tokens" | "duration" | "cache", BarChartSpec> {
  const models = summary.environment.models.join(", ") || "unknown model";
  const nNote = `${summary.runs.baseline + summary.runs.cursory} runs · ${models}`;
  return {
    tokens: {
      title: "Input token usage",
      subtitle: `${summary.benchmark.label} · ${nNote}`,
      unit: "tok",
      baseline: summary.average.baseline.inputTokens,
      cursory: summary.average.cursory.inputTokens,
      baselineMin: summary.min.baseline.inputTokens,
      baselineMax: summary.max.baseline.inputTokens,
      cursoryMin: summary.min.cursory.inputTokens,
      cursoryMax: summary.max.cursory.inputTokens,
      changePercent: summary.change.inputTokensPercent,
      baselineRuns: summary.runs.baseline,
      cursoryRuns: summary.runs.cursory,
    },
    duration: {
      title: "Response time",
      subtitle: `${summary.benchmark.label} · ${nNote}`,
      unit: "ms",
      baseline: summary.average.baseline.durationMs,
      cursory: summary.average.cursory.durationMs,
      baselineMin: summary.min.baseline.durationMs,
      baselineMax: summary.max.baseline.durationMs,
      cursoryMin: summary.min.cursory.durationMs,
      cursoryMax: summary.max.cursory.durationMs,
      changePercent: summary.change.durationPercent,
      baselineRuns: summary.runs.baseline,
      cursoryRuns: summary.runs.cursory,
    },
    cache: {
      title: "Cache read tokens",
      subtitle: `${summary.benchmark.label} · ${nNote}`,
      unit: "tok",
      baseline: summary.average.baseline.cacheReadTokens,
      cursory: summary.average.cursory.cacheReadTokens,
      baselineMin: summary.min.baseline.cacheReadTokens,
      baselineMax: summary.max.baseline.cacheReadTokens,
      cursoryMin: summary.min.cursory.cacheReadTokens,
      cursoryMax: summary.max.cursory.cacheReadTokens,
      changePercent: summary.change.cacheReadTokensPercent,
      baselineRuns: summary.runs.baseline,
      cursoryRuns: summary.runs.cursory,
    },
  };
}
