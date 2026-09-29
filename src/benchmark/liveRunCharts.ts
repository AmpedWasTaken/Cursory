import { COST_MODEL, estimateCostUsd, formatUsd } from "./costModel.js";
import type { BenchmarkRun, BenchmarkSummary } from "./liveRunSchema.js";
import { qualityOf } from "./liveRunSchema.js";
import { mean, percentChange } from "./liveRunStats.js";

const FONT = "ui-sans-serif, system-ui, sans-serif";
/** Single surface — no nested black+panel frame (avoids “double card” on GitHub). */
const BG = "#111111";
const CARD = "#1c1c1c";
const BASELINE = "#94a3b8";
const CURSORY = "#2dd4bf";
const AXIS = "#525252";
const TEXT = "#f5f5f5";
const MUTED = "#a3a3a3";
const GRID = "#2a2a2a";
const GOOD = "#34d399";
const BAD = "#f87171";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatChange(pct: number): string {
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function changeColor(pct: number, invertGood = false): string {
  const good = invertGood ? pct > 0 : pct < 0;
  const bad = invertGood ? pct < 0 : pct > 0;
  if (good) return GOOD;
  if (bad) return BAD;
  return MUTED;
}

function formatTok(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 1 : 2)}k`;
  return String(Math.round(n));
}

function formatSec(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function svgShell(
  width: number,
  height: number,
  title: string,
  body: string,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">
  <rect width="100%" height="100%" rx="12" fill="${BG}"/>
  ${body}
</svg>
`;
}

function costOf(run: BenchmarkRun): number {
  return run.estimatedCostUsd ?? estimateCostUsd(run.metrics);
}

export interface ChartHeadlines {
  tokensSavedPercent: number;
  costSavedPercent: number;
  qualityDeltaPercent: number;
  subtitle: string;
}

export function headlinesFrom(
  summary: BenchmarkSummary,
  runs: BenchmarkRun[],
): ChartHeadlines {
  const baseline = runs.filter((r) => r.variant === "baseline");
  const cursory = runs.filter((r) => r.variant === "cursory");
  const baseCost = mean(baseline.map(costOf));
  const cursoryCost = mean(cursory.map(costOf));
  const baseQuality = mean(baseline.map(qualityOf));
  const cursoryQuality = mean(cursory.map(qualityOf));
  const models = summary.environment.models.join(", ") || "model";
  return {
    tokensSavedPercent: summary.change.inputTokensPercent,
    costSavedPercent: percentChange(baseCost, cursoryCost),
    qualityDeltaPercent: cursoryQuality - baseQuality,
    subtitle: `${summary.benchmark.label} · ${summary.runs.baseline + summary.runs.cursory} runs · ${models}`,
  };
}

/** Big three headline numbers. */
export function renderHeadlineSvg(
  summary: BenchmarkSummary,
  runs: BenchmarkRun[],
): string {
  const h = headlinesFrom(summary, runs);
  const width = 720;
  const height = 220;
  const cards = [
    {
      label: "Tokens saved",
      value: formatChange(h.tokensSavedPercent),
      color: changeColor(h.tokensSavedPercent),
    },
    {
      label: "Cost saved",
      value: formatChange(h.costSavedPercent),
      color: changeColor(h.costSavedPercent),
    },
    {
      label: "Quality difference",
      value: formatChange(h.qualityDeltaPercent),
      color: changeColor(h.qualityDeltaPercent, true),
    },
  ];
  const cardW = 200;
  const gap = 24;
  const startX = (width - (cardW * 3 + gap * 2)) / 2;
  const cardsSvg = cards
    .map((c, i) => {
      const x = startX + i * (cardW + gap);
      return `
  <rect x="${x}" y="78" width="${cardW}" height="100" rx="12" fill="${CARD}" stroke="${GRID}"/>
  <text x="${x + cardW / 2}" y="118" text-anchor="middle" font-size="28" font-weight="700" fill="${c.color}" font-family="${FONT}">${escapeXml(c.value)}</text>
  <text x="${x + cardW / 2}" y="148" text-anchor="middle" font-size="13" fill="${MUTED}" font-family="${FONT}">${escapeXml(c.label)}</text>`;
    })
    .join("\n");

  const body = `
  <text x="36" y="44" font-size="18" font-weight="700" fill="${TEXT}" font-family="${FONT}">CURSORY BENCHMARK</text>
  <text x="36" y="64" font-size="12" fill="${MUTED}" font-family="${FONT}">${escapeXml(h.subtitle)}</text>
  ${cardsSvg}`;
  return svgShell(width, height, "Cursory benchmark headlines", body);
}

/** 1. Grouped bar — OFF vs ON for tokens/cost/duration/quality. */
export function renderGroupedBarSvg(
  summary: BenchmarkSummary,
  runs: BenchmarkRun[],
): string {
  const baseline = runs.filter((r) => r.variant === "baseline");
  const cursory = runs.filter((r) => r.variant === "cursory");
  const rows = [
    {
      label: "Tokens",
      off: mean(baseline.map((r) => r.metrics.inputTokens)),
      on: mean(cursory.map((r) => r.metrics.inputTokens)),
      format: formatTok,
      change: summary.change.inputTokensPercent,
    },
    {
      label: "Cost",
      off: mean(baseline.map(costOf)),
      on: mean(cursory.map(costOf)),
      format: (n: number) => formatUsd(n),
      change: percentChange(
        mean(baseline.map(costOf)),
        mean(cursory.map(costOf)),
      ),
    },
    {
      label: "Latency",
      off: mean(baseline.map((r) => r.metrics.durationMs)),
      on: mean(cursory.map((r) => r.metrics.durationMs)),
      format: formatSec,
      change: summary.change.durationPercent,
    },
    {
      label: "Quality",
      off: mean(baseline.map(qualityOf)),
      on: mean(cursory.map(qualityOf)),
      format: (n: number) => `${n.toFixed(0)}%`,
      change: mean(cursory.map(qualityOf)) - mean(baseline.map(qualityOf)),
    },
  ];

  const width = 720;
  const height = 360;
  const padL = 96;
  const padT = 88;
  const rowH = 56;
  const valueX = 520;
  const changeX = 680;
  const barMax = valueX - padL - 16;

  const rowsSvg = rows
    .map((row, i) => {
      const y = padT + i * rowH;
      const max = Math.max(row.off, row.on, 1e-9);
      const offW = Math.max(4, (row.off / max) * barMax);
      const onW = Math.max(4, (row.on / max) * barMax);
      const color = changeColor(
        row.label === "Quality" ? -row.change : row.change,
      );
      return `
  <text x="28" y="${y + 22}" font-size="13" fill="${TEXT}" font-family="${FONT}">${escapeXml(row.label)}</text>
  <rect x="${padL}" y="${y}" width="${offW}" height="14" rx="3" fill="${BASELINE}"/>
  <rect x="${padL}" y="${y + 20}" width="${onW}" height="14" rx="3" fill="${CURSORY}"/>
  <text x="${valueX}" y="${y + 12}" text-anchor="start" font-size="11" fill="${MUTED}" font-family="${FONT}">${escapeXml(row.format(row.off))}</text>
  <text x="${valueX}" y="${y + 32}" text-anchor="start" font-size="11" fill="${TEXT}" font-family="${FONT}">${escapeXml(row.format(row.on))}</text>
  <text x="${changeX}" y="${y + 22}" text-anchor="end" font-size="13" font-weight="700" fill="${color}" font-family="${FONT}">${escapeXml(formatChange(row.change))}</text>`;
    })
    .join("\n");

  const h = headlinesFrom(summary, runs);
  const body = `
  <text x="28" y="40" font-size="18" font-weight="700" fill="${TEXT}" font-family="${FONT}">Cursor vs Cursory</text>
  <text x="28" y="58" font-size="12" fill="${MUTED}" font-family="${FONT}">${escapeXml(h.subtitle)}</text>
  <rect x="480" y="32" width="10" height="10" rx="2" fill="${BASELINE}"/>
  <text x="496" y="41" font-size="11" fill="${MUTED}" font-family="${FONT}">Cursor (OFF)</text>
  <rect x="590" y="32" width="10" height="10" rx="2" fill="${CURSORY}"/>
  <text x="606" y="41" font-size="11" fill="${MUTED}" font-family="${FONT}">Cursory (ON)</text>
  ${rowsSvg}
  <text x="28" y="${height - 24}" font-size="11" fill="${MUTED}" font-family="${FONT}">Cost ${COST_MODEL.label}</text>`;

  return svgShell(width, height, "Cursor vs Cursory", body);
}

/** 2. Savings % marketing bars. */
export function renderSavingsPercentSvg(
  summary: BenchmarkSummary,
  runs: BenchmarkRun[],
): string {
  const baseline = runs.filter((r) => r.variant === "baseline");
  const cursory = runs.filter((r) => r.variant === "cursory");
  const rows = [
    {
      label: "Token usage",
      pct: summary.change.inputTokensPercent,
    },
    {
      label: "Cost",
      pct: percentChange(mean(baseline.map(costOf)), mean(cursory.map(costOf))),
    },
    {
      label: "Duration",
      pct: summary.change.durationPercent,
    },
    {
      label: "Cache read",
      pct: summary.change.cacheReadTokensPercent,
    },
  ];

  const width = 720;
  const height = 300;
  const padT = 80;
  const rowH = 44;
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.pct)), 1);

  const rowsSvg = rows
    .map((row, i) => {
      const y = padT + i * rowH;
      const w = (Math.abs(row.pct) / maxAbs) * 420;
      const color = changeColor(row.pct);
      return `
  <text x="28" y="${y + 18}" font-size="13" fill="${TEXT}" font-family="${FONT}">${escapeXml(row.label)}</text>
  <rect x="160" y="${y + 4}" width="${Math.max(w, 4)}" height="22" rx="4" fill="${color}" opacity="0.9"/>
  <text x="${168 + w}" y="${y + 20}" font-size="13" font-weight="700" fill="${color}" font-family="${FONT}">${escapeXml(formatChange(row.pct))}</text>`;
    })
    .join("\n");

  const h = headlinesFrom(summary, runs);
  const body = `
  <text x="28" y="40" font-size="18" font-weight="700" fill="${TEXT}" font-family="${FONT}">Savings vs Cursor</text>
  <text x="28" y="58" font-size="12" fill="${MUTED}" font-family="${FONT}">${escapeXml(h.subtitle)} · negative = Cursory used less</text>
  ${rowsSvg}`;
  return svgShell(width, height, "Savings vs Cursor", body);
}

/** 3. Scatter: quality vs tokens. */
export function renderQualityScatterSvg(runs: BenchmarkRun[]): string {
  const width = 720;
  const height = 340;
  const padL = 72;
  const padR = 40;
  const padT = 78;
  const padB = 50;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const xs = runs.map((r) => r.metrics.inputTokens);
  const ys = runs.map(qualityOf);
  const minX = Math.min(...xs, 0);
  const maxX = Math.max(...xs, 1);
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(100, ...ys);
  const xAt = (v: number) =>
    padL + ((v - minX) / Math.max(maxX - minX, 1)) * plotW;
  const yAt = (v: number) =>
    padT + plotH - ((v - minY) / Math.max(maxY - minY, 1)) * plotH;

  const points = runs
    .map((r) => {
      const x = xAt(r.metrics.inputTokens);
      const y = yAt(qualityOf(r));
      const fill = r.variant === "cursory" ? CURSORY : BASELINE;
      const label = r.variant === "cursory" ? "C" : "B";
      // Keep point labels below the top edge so they don't collide with the title.
      const labelY = Math.min(y + 4, padT + plotH - 8);
      return `<circle cx="${x}" cy="${y}" r="8" fill="${fill}" stroke="${BG}" stroke-width="2"/><text x="${x + 12}" y="${labelY}" font-size="11" fill="${MUTED}" font-family="${FONT}">${label}</text>`;
    })
    .join("\n");

  const midY = padT + plotH / 2;
  const body = `
  <text x="28" y="40" font-size="18" font-weight="700" fill="${TEXT}" font-family="${FONT}">Quality vs token usage</text>
  <text x="28" y="58" font-size="12" fill="${MUTED}" font-family="${FONT}">Ideal: high quality, lower tokens (upper-left)</text>
  <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="${AXIS}"/>
  <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="${AXIS}"/>
  <text x="14" y="${midY}" text-anchor="middle" font-size="11" fill="${MUTED}" font-family="${FONT}" transform="rotate(-90 14 ${midY})">Quality</text>
  <text x="${padL - 8}" y="${yAt(maxY) + 4}" text-anchor="end" font-size="10" fill="${MUTED}" font-family="${FONT}">${Math.round(maxY)}</text>
  <text x="${padL + plotW}" y="${padT + plotH + 28}" text-anchor="end" font-size="11" fill="${MUTED}" font-family="${FONT}">Input tokens →</text>
  ${points}
  <rect x="520" y="36" width="10" height="10" rx="2" fill="${BASELINE}"/>
  <text x="536" y="45" font-size="11" fill="${MUTED}" font-family="${FONT}">Cursor</text>
  <rect x="600" y="36" width="10" height="10" rx="2" fill="${CURSORY}"/>
  <text x="616" y="45" font-size="11" fill="${MUTED}" font-family="${FONT}">Cursory</text>`;
  return svgShell(width, height, "Quality vs token usage", body);
}

/** 4. Line chart across repeated runs. */
export function renderRunsLineSvg(runs: BenchmarkRun[]): string {
  const baseline = runs
    .filter((r) => r.variant === "baseline")
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const cursory = runs
    .filter((r) => r.variant === "cursory")
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const n = Math.max(baseline.length, cursory.length, 1);

  const width = 720;
  const height = 320;
  const padL = 72;
  const padR = 36;
  const padT = 78;
  const padB = 48;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const all = [...baseline, ...cursory].map((r) => r.metrics.inputTokens);
  const maxY = Math.max(...all, 1);
  const minY = 0;
  const xAt = (i: number, len: number) =>
    padL + (len <= 1 ? plotW / 2 : (i / (len - 1)) * plotW);
  const yAt = (v: number) =>
    padT + plotH - ((v - minY) / (maxY - minY)) * plotH;

  const poly = (series: BenchmarkRun[], color: string) => {
    if (series.length === 0) return "";
    const pts = series
      .map((r, i) => `${xAt(i, series.length)},${yAt(r.metrics.inputTokens)}`)
      .join(" ");
    const dots = series
      .map(
        (r, i) =>
          `<circle cx="${xAt(i, series.length)}" cy="${yAt(r.metrics.inputTokens)}" r="4" fill="${color}"/>`,
      )
      .join("");
    return `<polyline fill="none" stroke="${color}" stroke-width="2.5" points="${pts}"/>${dots}`;
  };

  const xLabels = Array.from({ length: n }, (_, i) => {
    const x = xAt(i, n);
    return `<text x="${x}" y="${padT + plotH + 22}" text-anchor="middle" font-size="10" fill="${MUTED}" font-family="${FONT}">${i + 1}</text>`;
  }).join("\n");

  const midY = padT + plotH / 2;
  const body = `
  <text x="28" y="40" font-size="18" font-weight="700" fill="${TEXT}" font-family="${FONT}">Token usage across runs</text>
  <text x="28" y="58" font-size="12" fill="${MUTED}" font-family="${FONT}">Same prompt · Cursor vs Cursory · n=${n} pairs</text>
  <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="${AXIS}"/>
  <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="${AXIS}"/>
  <text x="14" y="${midY}" text-anchor="middle" font-size="11" fill="${MUTED}" font-family="${FONT}" transform="rotate(-90 14 ${midY})">Tokens</text>
  <text x="${padL - 8}" y="${yAt(maxY) + 4}" text-anchor="end" font-size="10" fill="${MUTED}" font-family="${FONT}">${escapeXml(formatTok(maxY))}</text>
  <text x="${padL - 8}" y="${padT + plotH}" text-anchor="end" font-size="10" fill="${MUTED}" font-family="${FONT}">0</text>
  ${poly(baseline, BASELINE)}
  ${poly(cursory, CURSORY)}
  ${xLabels}
  <rect x="520" y="36" width="10" height="10" rx="2" fill="${BASELINE}"/>
  <text x="536" y="45" font-size="11" fill="${MUTED}" font-family="${FONT}">Cursor</text>
  <rect x="600" y="36" width="10" height="10" rx="2" fill="${CURSORY}"/>
  <text x="616" y="45" font-size="11" fill="${MUTED}" font-family="${FONT}">Cursory</text>`;
  return svgShell(width, height, "Token usage across runs", body);
}

/** 5. Cost per successful task table. */
export function renderCostPerSuccessSvg(runs: BenchmarkRun[]): string {
  const width = 720;
  const height = 260;
  const variants: Array<"baseline" | "cursory"> = ["baseline", "cursory"];
  const rows = variants.map((variant) => {
    const set = runs.filter((r) => r.variant === variant);
    const avgCost = mean(set.map(costOf));
    const passRate =
      set.length === 0
        ? 0
        : set.filter((r) => qualityOf(r) >= 100 || r.success === true).length /
          set.length;
    const successes = Math.max(
      set.filter((r) => r.success !== false && qualityOf(r) >= 50).length,
      passRate > 0 ? passRate * set.length : 0,
    );
    const costPerSuccess =
      successes > 0 ? (avgCost * set.length) / successes : avgCost;
    return {
      mode: variant === "baseline" ? "Cursor" : "Cursory",
      avgCost,
      passRate,
      costPerSuccess,
    };
  });

  const header = `
  <text x="40" y="100" font-size="12" fill="${MUTED}" font-family="${FONT}">Mode</text>
  <text x="220" y="100" font-size="12" fill="${MUTED}" font-family="${FONT}">Avg cost</text>
  <text x="380" y="100" font-size="12" fill="${MUTED}" font-family="${FONT}">Pass rate</text>
  <text x="520" y="100" font-size="12" fill="${MUTED}" font-family="${FONT}">Cost / success</text>
  <line x1="36" y1="112" x2="684" y2="112" stroke="${GRID}"/>`;

  const bodyRows = rows
    .map((row, i) => {
      const y = 140 + i * 36;
      const color = row.mode === "Cursory" ? CURSORY : BASELINE;
      return `
  <text x="40" y="${y}" font-size="15" font-weight="600" fill="${color}" font-family="${FONT}">${escapeXml(row.mode)}</text>
  <text x="220" y="${y}" font-size="15" fill="${TEXT}" font-family="${FONT}">${escapeXml(formatUsd(row.avgCost))}</text>
  <text x="380" y="${y}" font-size="15" fill="${TEXT}" font-family="${FONT}">${(row.passRate * 100).toFixed(0)}%</text>
  <text x="520" y="${y}" font-size="15" font-weight="700" fill="${TEXT}" font-family="${FONT}">${escapeXml(formatUsd(row.costPerSuccess))}</text>`;
    })
    .join("\n");

  const body = `
  <text x="28" y="40" font-size="18" font-weight="700" fill="${TEXT}" font-family="${FONT}">Cost per successful task</text>
  <text x="28" y="58" font-size="12" fill="${MUTED}" font-family="${FONT}">${COST_MODEL.label} · efficiency, not just token count</text>
  ${header}
  ${bodyRows}`;
  return svgShell(width, height, "Cost per successful task", body);
}

/** Simple dual bar (used by unit tests). */
export function renderComparisonBarSvg(input: {
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
}): string {
  const body = `
  <text x="36" y="44" font-size="18" font-weight="700" fill="${TEXT}" font-family="${FONT}">${escapeXml(input.title)}</text>
  <text x="36" y="64" font-size="12" fill="${MUTED}" font-family="${FONT}">${escapeXml(input.subtitle)}</text>
  <text x="680" y="44" text-anchor="end" font-size="16" font-weight="700" fill="${changeColor(input.changePercent)}" font-family="${FONT}">${escapeXml(formatChange(input.changePercent))}</text>
  <rect x="200" y="120" width="80" height="140" rx="8" fill="${BASELINE}"/>
  <rect x="400" y="140" width="80" height="120" rx="8" fill="${CURSORY}"/>
  <text x="240" y="280" text-anchor="middle" fill="${TEXT}" font-family="${FONT}">Baseline</text>
  <text x="440" y="280" text-anchor="middle" fill="${TEXT}" font-family="${FONT}">Cursory</text>
  <text x="240" y="300" text-anchor="middle" fill="${MUTED}" font-family="${FONT}">n=${input.baselineRuns}</text>
  <text x="440" y="300" text-anchor="middle" fill="${MUTED}" font-family="${FONT}">n=${input.cursoryRuns}</text>`;
  return svgShell(720, 340, input.title, body);
}

export function renderAllReadmeCharts(
  summary: BenchmarkSummary,
  runs: BenchmarkRun[],
): Record<string, string> {
  const scoped = runs.filter((r) => r.benchmark.id === summary.benchmark.id);
  const data = scoped.length ? scoped : runs;
  return {
    headline: renderHeadlineSvg(summary, data),
    grouped: renderGroupedBarSvg(summary, data),
    savings: renderSavingsPercentSvg(summary, data),
    "quality-scatter": renderQualityScatterSvg(data),
    "tokens-over-runs": renderRunsLineSvg(data),
    "cost-per-success": renderCostPerSuccessSvg(data),
    // aliases for older README paths
    overview: renderGroupedBarSvg(summary, data),
    tokens: renderGroupedBarSvg(summary, data),
    delta: renderSavingsPercentSvg(summary, data),
    slope: renderQualityScatterSvg(data),
    duration: renderRunsLineSvg(data),
    cache: renderCostPerSuccessSvg(data),
  };
}
