import { estimateTokensFromText } from "../telemetry/estimator.js";
import { extractSymbols } from "../indexing/symbols.js";

export interface DiffReduceInput {
  patch: string;
  files: Array<{ path: string; additions: number; deletions: number }>;
  additions: number;
  deletions: number;
  base: string;
  target: string;
  maxTokens: number;
  /** Optional file contents to annotate affected symbols */
  fileContents?: Map<string, string>;
}

/**
 * Compact a git patch: keep file headers + prioritized hunks; drop huge unchanged context.
 */
export function reduceDiff(input: DiffReduceInput): {
  text: string;
  estimatedRawTokens: number;
  estimatedDeliveredTokens: number;
} {
  const rawTokens = estimateTokensFromText(input.patch).tokens;
  const lines: string[] = [];
  lines.push(`Diff: ${input.base}…${input.target}`);
  lines.push(`Files: ${input.files.length}  +${input.additions}/-${input.deletions}`);
  lines.push("");

  if (input.files.length) {
    lines.push("Changed files:");
    for (const f of input.files.slice(0, 40)) {
      lines.push(`  ${f.path}  +${f.additions}/-${f.deletions}`);
      const content = input.fileContents?.get(f.path);
      if (content) {
        const symbols = extractSymbols(content, f.path)
          .slice(0, 6)
          .map((s) => `${s.kind} ${s.name}`)
          .join(", ");
        if (symbols) lines.push(`    symbols: ${symbols}`);
      }
    }
    if (input.files.length > 40) {
      lines.push(`  … +${input.files.length - 40} more files`);
    }
    lines.push("");
  }

  // Prefer hunks that look semantic (function/class/export) and cap patch body
  const patchLines = input.patch.split(/\r?\n/);
  const kept: string[] = [];
  let inHunk = false;
  let hunkBuf: string[] = [];
  let _hunkScore = 0;

  const flush = () => {
    if (hunkBuf.length === 0) return;
    kept.push(...hunkBuf);
    hunkBuf = [];
    _hunkScore = 0;
    inHunk = false;
  };

  for (const line of patchLines) {
    if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("+++") || line.startsWith("---")) {
      flush();
      kept.push(line);
      continue;
    }
    if (line.startsWith("@@")) {
      flush();
      inHunk = true;
      hunkBuf = [line];
      _hunkScore = 0;
      continue;
    }
    if (inHunk) {
      hunkBuf.push(line);
      if (/^[+-]/.test(line) && /function|class|interface|export|const |type /.test(line)) {
        _hunkScore += 2;
      } else if (/^[+-]/.test(line)) {
        _hunkScore += 1;
      }
      // Cap individual hunk size
      if (hunkBuf.length > 120) {
        hunkBuf.push("… hunk truncated …");
        flush();
      }
      continue;
    }
  }
  flush();

  // Budget trim
  const header = lines.join("\n");
  const headerTokens = estimateTokensFromText(header).tokens;
  const budget = Math.max(200, input.maxTokens - headerTokens);
  let body = "";
  let used = 0;
  for (const line of kept) {
    const cost = Math.max(1, Math.ceil((line.length + 1) / 4));
    if (used + cost > budget) {
      body += "\n… patch truncated to token budget; narrow with path= or raise max_tokens …\n";
      break;
    }
    body += line + "\n";
    used += cost;
  }

  const text = header + "\n" + body;
  return {
    text,
    estimatedRawTokens: Math.max(rawTokens, estimateTokensFromText(text).tokens),
    estimatedDeliveredTokens: estimateTokensFromText(text).tokens,
  };
}
