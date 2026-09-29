import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BenchmarkTaskDef } from "./types.js";

export function parseTaskDef(raw: unknown): BenchmarkTaskDef {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Task definition must be an object");
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id.trim()) {
    throw new Error("Task needs string id");
  }
  if (typeof o.repo !== "string" || !o.repo.trim()) {
    throw new Error("Task needs string repo");
  }
  if (typeof o.prompt !== "string" || !o.prompt.trim()) {
    throw new Error("Task needs string prompt");
  }
  const model =
    typeof o.model === "string" && o.model.trim()
      ? o.model.trim()
      : "composer-2.5";
  const commit = typeof o.commit === "string" ? o.commit.trim() : "";
  const runs =
    typeof o.runs === "number" && Number.isFinite(o.runs) && o.runs > 0
      ? Math.floor(o.runs)
      : 1;

  let verification: BenchmarkTaskDef["verification"];
  if (o.verification && typeof o.verification === "object") {
    const v = o.verification as Record<string, unknown>;
    if (typeof v.command === "string" && v.command.trim()) {
      verification = {
        command: v.command.trim(),
        timeoutMs:
          typeof v.timeoutMs === "number" ? v.timeoutMs : undefined,
      };
    }
  }

  return {
    id: o.id.trim(),
    label:
      typeof o.label === "string" && o.label.trim()
        ? o.label.trim()
        : undefined,
    repo: o.repo.trim(),
    commit,
    model,
    prompt: o.prompt.trim(),
    verification,
    expectText:
      typeof o.expectText === "string" ? o.expectText : undefined,
    runs,
  };
}

export function loadTaskFile(path: string): BenchmarkTaskDef {
  const abs = resolve(path);
  if (!existsSync(abs)) throw new Error(`Task file not found: ${abs}`);
  return parseTaskDef(JSON.parse(readFileSync(abs, "utf8")));
}

export function listTaskFiles(tasksDir: string): string[] {
  if (!existsSync(tasksDir)) return [];
  return readdirSync(tasksDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => join(tasksDir, f))
    .sort();
}

export function resolveTaskId(
  tasksDir: string,
  idOrPath: string,
): BenchmarkTaskDef {
  if (idOrPath.endsWith(".json") || existsSync(resolve(idOrPath))) {
    return loadTaskFile(idOrPath);
  }
  const direct = join(tasksDir, `${idOrPath}.json`);
  if (existsSync(direct)) return loadTaskFile(direct);
  const matches = listTaskFiles(tasksDir).filter((p) =>
    p.replace(/\\/g, "/").includes(`/${idOrPath}.json`),
  );
  if (matches[0]) return loadTaskFile(matches[0]);
  throw new Error(
    `Unknown benchmark task "${idOrPath}". Looked in ${tasksDir}`,
  );
}
