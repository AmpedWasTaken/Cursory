import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ensureDataDir } from "../telemetry/stats.js";

export interface RawResultMeta {
  resultId: string;
  createdAt: string;
  expiresAt: string;
  command: string;
  cwd: string;
  exitCode: number | null;
  timedOut: boolean;
  mode: string;
  stdoutBytes: number;
  stderrBytes: number;
  totalLines: number;
  stdoutFile: string;
  stderrFile: string;
  combinedFile: string;
  metaFile: string;
}

function rawRoot(): string {
  const dir = join(ensureDataDir(), "raw");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function createResultId(): string {
  const ts = Date.now().toString(36);
  const rand = randomBytes(4).toString("hex");
  return `run_${ts}_${rand}`;
}

export function storeRawResult(input: {
  command: string;
  cwd: string;
  exitCode: number | null;
  timedOut: boolean;
  mode: string;
  stdout: string;
  stderr: string;
  retainRawMinutes: number;
}): RawResultMeta {
  const resultId = createResultId();
  const dir = join(rawRoot(), resultId);
  mkdirSync(dir, { recursive: true });

  const stdoutFile = "stdout.txt";
  const stderrFile = "stderr.txt";
  const combinedFile = "combined.txt";
  const metaFile = "meta.json";

  writeFileSync(join(dir, stdoutFile), input.stdout, "utf8");
  writeFileSync(join(dir, stderrFile), input.stderr, "utf8");
  const combined =
    input.stdout + (input.stderr ? `\n----- stderr -----\n${input.stderr}` : "");
  writeFileSync(join(dir, combinedFile), combined, "utf8");

  const created = new Date();
  const expires = new Date(created.getTime() + input.retainRawMinutes * 60_000);
  const totalLines = combined.length === 0 ? 0 : combined.split(/\r?\n/).length;

  const meta: RawResultMeta = {
    resultId,
    createdAt: created.toISOString(),
    expiresAt: expires.toISOString(),
    command: input.command,
    cwd: input.cwd,
    exitCode: input.exitCode,
    timedOut: input.timedOut,
    mode: input.mode,
    stdoutBytes: Buffer.byteLength(input.stdout, "utf8"),
    stderrBytes: Buffer.byteLength(input.stderr, "utf8"),
    totalLines,
    stdoutFile,
    stderrFile,
    combinedFile,
    metaFile,
  };
  writeFileSync(join(dir, metaFile), JSON.stringify(meta, null, 2), "utf8");
  return meta;
}

export function loadRawMeta(resultId: string): RawResultMeta | null {
  const safeId = sanitizeResultId(resultId);
  if (!safeId) return null;
  const metaPath = join(rawRoot(), safeId, "meta.json");
  if (!existsSync(metaPath)) return null;
  try {
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as RawResultMeta;
    if (new Date(meta.expiresAt).getTime() < Date.now()) {
      return null;
    }
    return meta;
  } catch {
    return null;
  }
}

export function loadRawCombined(resultId: string): string | null {
  const meta = loadRawMeta(resultId);
  if (!meta) return null;
  const safeId = sanitizeResultId(resultId);
  if (!safeId) return null;
  const path = join(rawRoot(), safeId, meta.combinedFile);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

export function listRecentRawResults(limit = 12): RawResultMeta[] {
  const root = rawRoot();
  const items: RawResultMeta[] = [];
  try {
    for (const name of readdirSync(root)) {
      const meta = loadRawMeta(name);
      if (meta) items.push(meta);
    }
  } catch {
    return [];
  }
  items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return items.slice(0, Math.max(1, limit));
}

export function cleanupExpiredRawResults(): number {
  const root = rawRoot();
  let removed = 0;
  try {
    for (const name of readdirSync(root)) {
      const metaPath = join(root, name, "meta.json");
      if (!existsSync(metaPath)) continue;
      try {
        const meta = JSON.parse(readFileSync(metaPath, "utf8")) as RawResultMeta;
        if (new Date(meta.expiresAt).getTime() < Date.now()) {
          rmSync(join(root, name), { recursive: true, force: true });
          removed += 1;
        }
      } catch {
        // leave alone
      }
    }
  } catch {
    return removed;
  }
  return removed;
}

function sanitizeResultId(resultId: string): string | null {
  if (!/^run_[a-z0-9]+_[a-f0-9]+$/i.test(resultId)) {
    return null;
  }
  return resultId;
}

export function fingerprintCommand(command: string, cwd: string): string {
  return createHash("sha256").update(`${cwd}\n${command}`).digest("hex").slice(0, 16);
}
