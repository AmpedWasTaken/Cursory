import { splitLines, collapseRepeats, trimToBudget, type ReduceInput, type ReduceResult } from "./terminalReducer.js";

/**
 * Log reducer: keep exceptions/warnings/request IDs near failures; sample + count repeats.
 */
export function reduceLogs(input: ReduceInput): ReduceResult {
  const combined = [input.stdout, input.stderr].filter(Boolean).join("\n");
  const rawLines = splitLines(combined);

  const counts = new Map<string, number>();
  const interesting: string[] = [];
  const samples: string[] = [];

  for (const line of rawLines) {
    const t = line.trim();
    if (!t) continue;

    const key = t.replace(/\d{4}-\d{2}-\d{2}T[\d:.Z+-]+/g, "<ts>").replace(/\b[0-9a-f]{8,}\b/gi, "<id>");
    counts.set(key, (counts.get(key) ?? 0) + 1);

    if (
      /exception|error|fatal|panic|warn|warning|critical|traceback|stack/i.test(t) ||
      /request[_-]?id|trace[_-]?id|correlation/i.test(t)
    ) {
      if (interesting.length < 150) interesting.push(line);
    } else if (samples.length < 30) {
      samples.push(line);
    }
  }

  const topRepeats = [...counts.entries()]
    .filter(([, n]) => n >= 5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([k, n]) => `${n}× ${k.slice(0, 160)}`);

  const header = [
    `command: ${input.command}`,
    `exit: ${input.exitCode ?? "null"}${input.timedOut ? " (timed out)" : ""}`,
    `raw_lines: ${rawLines.length}`,
  ];

  const body = collapseRepeats([
    ...(topRepeats.length ? ["--- repeated messages ---", ...topRepeats, ""] : []),
    ...(interesting.length ? ["--- errors/warnings ---", ...interesting, ""] : []),
    ...(samples.length ? ["--- samples ---", ...samples] : []),
  ]);

  const lines = trimToBudget([...header, "", ...body], input.maxTokens);
  return {
    text: lines.join("\n"),
    mode: "logs",
    keptLines: lines.length,
    rawLines: rawLines.length,
  };
}
