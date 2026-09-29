import { splitLines, collapseRepeats, trimToBudget, type ReduceInput, type ReduceResult } from "./terminalReducer.js";

function isPassingFileLine(t: string): boolean {
  if (/fail|error|×|✕|✘/i.test(t) && !/\b\d+\s+failed\b/i.test(t)) {
    // keep lines that mention failure counts in summaries handled elsewhere
  }
  if (/^\s*(✓|✔|√|PASS|OK)\b/i.test(t) && !/fail/i.test(t)) {
    return true;
  }
  // Vitest-style: "path (2 tests) 1ms" without failed
  if (
    /\(\d+\s+tests?\)\s+\d+\s*m?s\b/i.test(t) &&
    !/failed|FAIL\b/i.test(t) &&
    !/^\s*(×|✕|✘|FAIL)\b/i.test(t)
  ) {
    return true;
  }
  return false;
}

/**
 * Test-oriented reducer: preserve totals, failures, stacks; drop endless pass lists.
 */
export function reduceTests(input: ReduceInput): ReduceResult {
  const combined = [input.stdout, input.stderr].filter(Boolean).join("\n");
  const rawLines = splitLines(combined);

  const summary: string[] = [];
  const failures: string[] = [];
  const stacks: string[] = [];
  let inFailure = false;
  let passNoise = 0;

  for (const line of rawLines) {
    const t = line.trim();
    if (!t) continue;

    if (isPassingFileLine(t) && !/\b\d+\s+failed\b/i.test(t) && !/^FAIL\b/i.test(t)) {
      passNoise += 1;
      continue;
    }

    if (
      /\bTest Files\b/i.test(t) ||
      /^\s*Tests\s+/i.test(t) ||
      /\bDuration\b/i.test(t) ||
      /\bSnapshots\b/i.test(t) ||
      /\b\d+\s+(passed|failed|skipped)\b/i.test(t)
    ) {
      summary.push(line);
      continue;
    }

    if (
      /^\s*(×|✕|✘|FAIL|FAILED|x)\b/i.test(t) ||
      /^FAIL\b/.test(t) ||
      /AssertionError|Expected:|Received:|Expected |Received /i.test(t) ||
      /\bat\s+.+\(.+:\d+:\d+\)/.test(t) ||
      /\.(?:test|spec)\.[jt]sx?:\d+/i.test(t)
    ) {
      inFailure = true;
      failures.push(line);
      continue;
    }

    if (inFailure) {
      if (isPassingFileLine(t) || /^\s*(Test Files|Tests\s+)/i.test(t)) {
        inFailure = false;
        if (isPassingFileLine(t)) {
          passNoise += 1;
          continue;
        }
        summary.push(line);
      } else if (stacks.length < 200) {
        stacks.push(line);
      }
    }
  }

  const header = [
    `command: ${input.command}`,
    `exit: ${input.exitCode ?? "null"}${input.timedOut ? " (timed out)" : ""}`,
    `raw_lines: ${rawLines.length}`,
    passNoise > 0 ? `suppressed_passing_lines: ${passNoise}` : "",
  ].filter(Boolean);

  const body = collapseRepeats([
    ...summary.slice(0, 40),
    "",
    ...(failures.length
      ? ["--- failures ---", ...failures.slice(0, 120)]
      : ["--- failures ---", "(none detected)"]),
    ...(stacks.length ? ["", "--- stacks (sample) ---", ...stacks.slice(0, 80)] : []),
  ]);

  const lines = trimToBudget([...header, "", ...body], input.maxTokens);
  return {
    text: lines.join("\n"),
    mode: "tests",
    keptLines: lines.length,
    rawLines: rawLines.length,
  };
}
