export interface ReduceInput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  command: string;
  maxTokens: number;
}

export interface ReduceResult {
  text: string;
  mode: string;
  keptLines: number;
  rawLines: number;
}

const PROGRESS_RE =
  /^\s*(?:✓|✔|√|●|○|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏|\[[= ]+\]|\d+%|download|downloading|installing)\b/i;

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function collapseRepeats(lines: string[], minRepeat = 5): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    let j = i + 1;
    while (j < lines.length && lines[j] === line) j += 1;
    const count = j - i;
    if (count >= minRepeat && line.trim().length > 0) {
      out.push(line);
      out.push(`… repeated ${count - 1} more identical lines …`);
    } else {
      for (let k = i; k < j; k++) out.push(lines[k]!);
    }
    i = j;
  }
  return out;
}

function approxTokens(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / 4);
}

function trimToBudget(lines: string[], maxTokens: number): string[] {
  const out: string[] = [];
  let used = 0;
  for (const line of lines) {
    const cost = Math.max(1, Math.ceil((line.length + 1) / 4));
    if (used + cost > maxTokens) {
      out.push("… truncated to token budget; use cursory_get_raw to expand …");
      break;
    }
    out.push(line);
    used += cost;
  }
  return out;
}

/**
 * Generic terminal reducer: keep errors/warnings/summaries/stacks; drop progress noise.
 */
export function reduceTerminal(input: ReduceInput): ReduceResult {
  const combined = [input.stdout, input.stderr].filter(Boolean).join("\n----- stderr -----\n");
  const rawLines = splitLines(combined);
  const interesting: string[] = [];
  const samples: string[] = [];

  for (const line of rawLines) {
    const t = line.trim();
    if (!t) continue;
    if (PROGRESS_RE.test(t)) continue;
    if (
      /error|fail|exception|warn|warning|fatal|panic|trace|errno|eacces|enoent/i.test(t) ||
      /^\s*at\s+\S+/.test(t) ||
      /exit code|elife?cycle|failed/i.test(t)
    ) {
      interesting.push(line);
    } else if (samples.length < 40) {
      samples.push(line);
    }
  }

  const header = [
    `command: ${input.command}`,
    `exit: ${input.exitCode ?? "null"}${input.timedOut ? " (timed out)" : ""}`,
    `raw_lines: ${rawLines.length}`,
  ];

  let body = collapseRepeats([...interesting, ...samples.slice(-20)]);
  if (interesting.length === 0 && samples.length === 0) {
    body = rawLines.slice(-30);
  }

  const lines = trimToBudget([...header, "", ...body], input.maxTokens);
  const text = lines.join("\n");
  return {
    text,
    mode: "terminal",
    keptLines: lines.length,
    rawLines: rawLines.length,
  };
}

export { splitLines, collapseRepeats, approxTokens, trimToBudget, PROGRESS_RE };
