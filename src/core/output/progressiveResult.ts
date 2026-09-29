export interface ProgressiveMeta {
  level: 1 | 2 | 3 | 4;
  summary: string;
  canExpand: boolean;
  expandHint: string;
}

export function level1Summary(summary: string): ProgressiveMeta {
  return {
    level: 1,
    summary,
    canExpand: true,
    expandHint: "Narrow with symbol/intent or raise max_tokens; use get_raw for more lines.",
  };
}

export function level2Excerpts(summary: string): ProgressiveMeta {
  return {
    level: 2,
    summary,
    canExpand: true,
    expandHint: "Request more lines, another symbol, or cursory_get_raw if needed.",
  };
}

export function level4Full(summary: string): ProgressiveMeta {
  return {
    level: 4,
    summary,
    canExpand: false,
    expandHint: "Full content returned.",
  };
}

export function sliceLines(
  content: string,
  startLine: number,
  endLine: number,
): { text: string; startLine: number; endLine: number; totalLines: number } {
  const lines = content.split(/\r?\n/);
  const totalLines = lines.length;
  const start = Math.max(1, Math.min(startLine, totalLines || 1));
  const end = Math.max(start, Math.min(endLine, totalLines || 1));
  const text = lines.slice(start - 1, end).join("\n");
  return { text, startLine: start, endLine: end, totalLines };
}

export function withLineNumbers(text: string, startLine: number): string {
  const lines = text.split(/\r?\n/);
  return lines
    .map((line, i) => `${String(startLine + i).padStart(6, " ")}|${line}`)
    .join("\n");
}
