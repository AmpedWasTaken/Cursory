export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[]; // prefixed with ' ', '+', '-'
}

/**
 * Simple line-oriented unified diff (deterministic, no deps).
 * Good enough for Cursory delta reads; not a full Myers implementation.
 */
export function unifiedLineDiff(
  oldText: string,
  newText: string,
  context = 3,
): { hunks: DiffHunk[]; text: string; changedLines: number } {
  const a = oldText.split(/\r?\n/);
  const b = newText.split(/\r?\n/);
  // Drop trailing empty line artifact from split when both end with newline handled naturally.

  const ops = diffOps(a, b);
  const hunks: DiffHunk[] = [];
  let changedLines = 0;

  let i = 0;
  while (i < ops.length) {
    // skip equals until we near a change
    while (i < ops.length && ops[i]!.type === "eq") i += 1;
    if (i >= ops.length) break;

    const changeStart = i;
    let j = i;
    while (j < ops.length) {
      if (ops[j]!.type !== "eq") {
        j += 1;
        continue;
      }
      // look ahead for nearby changes within 2*context
      let k = j;
      let eqRun = 0;
      while (k < ops.length && ops[k]!.type === "eq") {
        eqRun += 1;
        k += 1;
      }
      if (k < ops.length && ops[k]!.type !== "eq" && eqRun <= context * 2) {
        j = k;
        continue;
      }
      break;
    }

    // Include context lines around the changed span.
    const pre = ops.slice(Math.max(0, changeStart - context), changeStart);
    const mid = ops.slice(changeStart, j);
    const post = ops.slice(j, Math.min(ops.length, j + context));
    const block = [...pre, ...mid, ...post];

    let oldStart = 0;
    let newStart = 0;
    // compute starting line numbers from ops before block
    const blockStartIdx = Math.max(0, changeStart - context);
    for (let t = 0; t < blockStartIdx; t++) {
      const op = ops[t]!;
      if (op.type === "eq" || op.type === "del") oldStart += 1;
      if (op.type === "eq" || op.type === "add") newStart += 1;
    }
    oldStart += 1;
    newStart += 1;

    let oldCount = 0;
    let newCount = 0;
    const lines: string[] = [];
    for (const op of block) {
      if (op.type === "eq") {
        lines.push(` ${op.line}`);
        oldCount += 1;
        newCount += 1;
      } else if (op.type === "del") {
        lines.push(`-${op.line}`);
        oldCount += 1;
        changedLines += 1;
      } else {
        lines.push(`+${op.line}`);
        newCount += 1;
        changedLines += 1;
      }
    }

    hunks.push({ oldStart, oldCount, newStart, newCount, lines });
    i = j;
  }

  const text = hunks
    .map((h) => {
      const header = `@@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@`;
      return [header, ...h.lines].join("\n");
    })
    .join("\n\n");

  return { hunks, text, changedLines };
}

type Op = { type: "eq" | "add" | "del"; line: string };

/**
 * Greedy LCS-ish walk using a next-match index map (works well for typical edits).
 */
function diffOps(a: string[], b: string[]): Op[] {
  const ops: Op[] = [];
  // Map line -> queue of indices in b
  const index = new Map<string, number[]>();
  for (let j = 0; j < b.length; j++) {
    const line = b[j]!;
    const arr = index.get(line);
    if (arr) arr.push(j);
    else index.set(line, [j]);
  }
  const usedB = new Array(b.length).fill(false);
  let bi = 0;
  for (let ai = 0; ai < a.length; ai++) {
    const line = a[ai]!;
    const candidates = index.get(line) ?? [];
    let match = -1;
    for (const cand of candidates) {
      if (!usedB[cand] && cand >= bi) {
        match = cand;
        break;
      }
    }
    if (match === -1) {
      ops.push({ type: "del", line });
      continue;
    }
    while (bi < match) {
      if (!usedB[bi]) {
        ops.push({ type: "add", line: b[bi]! });
        usedB[bi] = true;
      }
      bi += 1;
    }
    ops.push({ type: "eq", line });
    usedB[match] = true;
    bi = match + 1;
  }
  while (bi < b.length) {
    if (!usedB[bi]) ops.push({ type: "add", line: b[bi]! });
    bi += 1;
  }
  return ops;
}

/** Extract surrounding exact new-file lines for each hunk (never rewrite). */
export function surroundingFromHunks(
  newText: string,
  hunks: DiffHunk[],
  radius = 2,
): string {
  const lines = newText.split(/\r?\n/);
  const ranges: Array<{ start: number; end: number }> = [];
  for (const h of hunks) {
    const start = Math.max(1, h.newStart - radius);
    const end = Math.min(lines.length, h.newStart + h.newCount - 1 + radius);
    ranges.push({ start, end });
  }
  // merge overlapping
  ranges.sort((x, y) => x.start - y.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (!last || r.start > last.end + 1) merged.push({ ...r });
    else last.end = Math.max(last.end, r.end);
  }
  const parts: string[] = [];
  for (const r of merged) {
    parts.push(`--- exact lines ${r.start}-${r.end} ---`);
    for (let i = r.start; i <= r.end; i++) {
      parts.push(`${String(i).padStart(6, " ")}|${lines[i - 1] ?? ""}`);
    }
  }
  return parts.join("\n");
}
