import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resetSessionContentCache } from "../core/cache/sessionCache.js";
import { reduceDiff } from "../core/output/diffReducer.js";
import { reduceLogs } from "../core/output/logReducer.js";
import { loadRawCombined, storeRawResult } from "../core/output/rawStore.js";
import { reduceTests } from "../core/output/testReducer.js";
import { estimateTokensFromText } from "../core/telemetry/estimator.js";
import { buildGetRaw } from "../mcp/tools/getRaw.js";
import { buildSmartRead } from "../mcp/tools/smartRead.js";
import { buildWorkspaceMap } from "../mcp/tools/workspaceMap.js";
import { runContextPipelineScenarios } from "./contextScenarios.js";
import type { RecoverabilityCheck, ScenarioResult } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_MINI = join(here, "../../test/fixtures/mini-repo");
export const FIXTURE_TERMINAL = join(here, "../../test/fixtures/terminal");

function fmtTok(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function buildLargeSource(): string {
  const methods: string[] = [];
  for (let i = 0; i < 120; i++) {
    methods.push(
      [
        `  /** generated helper ${i} */`,
        `  helper${i}(input: number): number {`,
        `    const x = input + ${i};`,
        `    return x * ${i + 1};`,
        `  }`,
      ].join("\n"),
    );
  }
  return [
    "export class CatalogService {",
    ...methods,
    "  processCheckout(cartId: string): boolean {",
    '    if (!cartId) throw new Error("missing cart");',
    "    return cartId.startsWith(\"cart_\");",
    "  }",
    "}",
    "",
    "export function createCatalog(): CatalogService {",
    "  return new CatalogService();",
    "}",
    "",
  ].join("\n");
}

function buildSyntheticPatch(): string {
  const hunks: string[] = [];
  for (let i = 0; i < 40; i++) {
    hunks.push(
      [
        `diff --git a/src/gen/file${i}.ts b/src/gen/file${i}.ts`,
        `index 1111111..2222222 100644`,
        `--- a/src/gen/file${i}.ts`,
        `+++ b/src/gen/file${i}.ts`,
        `@@ -1,20 +1,28 @@`,
        ` export function unused${i}() {`,
        `   return ${i};`,
        ` }`,
        ...Array.from({ length: 12 }, (_, j) => ` const noise${j} = ${j};`),
        `+export function changed${i}() {`,
        `+  return ${i} * 2;`,
        `+}`,
        `+export class Widget${i} {`,
        `+  run() { return ${i}; }`,
        `+}`,
      ].join("\n"),
    );
  }
  return hunks.join("\n");
}

export function runRepositoryDiscovery(): ScenarioResult {
  const map = buildWorkspaceMap({ workspaceRoot: FIXTURE_MINI });
  const ok =
    map.scan.indexedCount > 0 &&
    (map.text.includes("PaymentService") ||
      map.text.includes("src/") ||
      map.text.includes("TypeScript"));
  return {
    name: "Repository discovery",
    baselineTokens: map.estimatedRawTokens,
    cursoryTokens: map.estimatedDeliveredTokens,
    taskSuccess: ok,
    detail: ok
      ? `indexed=${map.scan.indexedCount} omitted=${map.scan.omittedFromWalk}`
      : "map missing expected workspace signals",
  };
}

export function runLargeTestOutput(): ScenarioResult {
  const stdout = readFileSync(join(FIXTURE_TERMINAL, "vitest-large.txt"), "utf8");
  const baseline = estimateTokensFromText(stdout).tokens;
  const reduced = reduceTests({
    stdout,
    stderr: "",
    exitCode: 1,
    timedOut: false,
    command: "pnpm test",
    maxTokens: 4000,
  });
  const delivered = estimateTokensFromText(reduced.text).tokens;
  const ok =
    reduced.text.includes("Expected 200") &&
    reduced.text.includes("auth.test") &&
    /3 failed/i.test(reduced.text);
  return {
    name: "Large test output",
    baselineTokens: baseline,
    cursoryTokens: delivered,
    taskSuccess: ok,
    detail: ok
      ? `kept failures; ${fmtTok(baseline)}→${fmtTok(delivered)}`
      : "reduced output missing failure signals",
  };
}

export function runLargeLog(): ScenarioResult {
  const stdout = readFileSync(join(FIXTURE_TERMINAL, "server.log"), "utf8");
  const baseline = estimateTokensFromText(stdout).tokens;
  const reduced = reduceLogs({
    stdout,
    stderr: "",
    exitCode: 0,
    timedOut: false,
    command: "type server.log",
    maxTokens: 3000,
  });
  const delivered = estimateTokensFromText(reduced.text).tokens;
  const ok =
    /exception|ERROR/i.test(reduced.text) && reduced.text.includes("refreshToken");
  return {
    name: "Large log",
    baselineTokens: baseline,
    cursoryTokens: delivered,
    taskSuccess: ok,
    detail: ok
      ? `kept error lines; ${fmtTok(baseline)}→${fmtTok(delivered)}`
      : "reduced log missing error signals",
  };
}

export function runRelevantCodeRead(): ScenarioResult {
  const root = mkdtempSync(join(tmpdir(), "cursory-bench-read-"));
  mkdirSync(join(root, "src"), { recursive: true });
  const content = buildLargeSource();
  const rel = "src/CatalogService.ts";
  writeFileSync(join(root, rel), content, "utf8");
  resetSessionContentCache();
  try {
    const baseline = estimateTokensFromText(content).tokens;
    const result = buildSmartRead({
      workspaceRoot: root,
      path: rel,
      symbol: "processCheckout",
    });
    const ok =
      result.text.includes("processCheckout") &&
      result.text.includes("cart_") &&
      result.returnedLines < result.totalLines;
    return {
      name: "Relevant code read",
      baselineTokens: baseline,
      cursoryTokens: result.estimatedDeliveredTokens,
      taskSuccess: ok,
      detail: ok
        ? `symbol slice L${result.returnedLines}/${result.totalLines}`
        : "symbol slice missing exact processCheckout source",
    };
  } finally {
    resetSessionContentCache();
    rmSync(root, { recursive: true, force: true });
  }
}

export function runRepeatedFileRead(): ScenarioResult {
  resetSessionContentCache();
  try {
    const first = buildSmartRead({
      workspaceRoot: FIXTURE_MINI,
      path: "src/lib/PaymentService.ts",
      symbol: "processPayment",
    });
    const second = buildSmartRead({
      workspaceRoot: FIXTURE_MINI,
      path: "src/lib/PaymentService.ts",
      symbol: "processPayment",
    });
    const baseline = first.estimatedDeliveredTokens;
    const delivered = second.estimatedDeliveredTokens;
    const ok = second.cacheHit && delivered < baseline;
    return {
      name: "Repeated file read",
      baselineTokens: baseline,
      cursoryTokens: delivered,
      taskSuccess: ok,
      detail: ok
        ? "session cache hit on unchanged symbol slice"
        : "expected cache hit on second read",
    };
  } finally {
    resetSessionContentCache();
  }
}

export function runLargeGitDiff(): ScenarioResult {
  const patch = buildSyntheticPatch();
  const files = Array.from({ length: 40 }, (_, i) => ({
    path: `src/gen/file${i}.ts`,
    additions: 8,
    deletions: 0,
  }));
  const baseline = estimateTokensFromText(patch).tokens;
  const reduced = reduceDiff({
    patch,
    files,
    additions: 40 * 8,
    deletions: 0,
    base: "HEAD~1",
    target: "HEAD",
    maxTokens: 2500,
  });
  const ok =
    reduced.text.includes("Changed files:") &&
    reduced.estimatedDeliveredTokens < baseline &&
    /Widget0|changed0|file0\.ts/.test(reduced.text);
  return {
    name: "Large git diff",
    baselineTokens: baseline,
    cursoryTokens: reduced.estimatedDeliveredTokens,
    taskSuccess: ok,
    detail: ok
      ? `patch ${fmtTok(baseline)}→${fmtTok(reduced.estimatedDeliveredTokens)}`
      : "diff reducer failed to keep file headers under budget",
  };
}

export function runRecoverabilityChecks(): RecoverabilityCheck[] {
  const checks: RecoverabilityCheck[] = [];
  const rawPayload =
    "LINE_A unique-marker-alpha\n" +
    Array.from({ length: 80 }, (_, i) => `noise ${i}`).join("\n") +
    "\nLINE_Z unique-marker-omega\n";

  const meta = storeRawResult({
    command: "benchmark-raw",
    cwd: FIXTURE_MINI,
    exitCode: 0,
    timedOut: false,
    mode: "raw",
    stdout: rawPayload,
    stderr: "",
    retainRawMinutes: 30,
  });
  const loaded = loadRawCombined(meta.resultId);
  const exactOk = loaded === rawPayload;
  checks.push({
    name: "raw store round-trip",
    ok: exactOk,
    detail: exactOk
      ? `resultId=${meta.resultId}`
      : `stored bytes=${loaded?.length ?? 0} expected=${rawPayload.length}`,
  });

  const got = buildGetRaw({
    workspaceRoot: FIXTURE_MINI,
    resultId: meta.resultId,
    search: "unique-marker-omega",
  });
  const searchOk = got.found && got.text.includes("unique-marker-omega");
  checks.push({
    name: "get_raw search",
    ok: searchOk,
    detail: searchOk ? "search recovered omitted marker" : "get_raw search missed marker",
  });

  resetSessionContentCache();
  try {
    const full = buildSmartRead({
      workspaceRoot: FIXTURE_MINI,
      path: "src/lib/PaymentService.ts",
      forceFull: true,
    });
    const file = readFileSync(join(FIXTURE_MINI, "src/lib/PaymentService.ts"), "utf8");
    const forceOk =
      full.text.includes("processPayment") &&
      full.text.includes("refreshToken") &&
      file.split(/\r?\n/).every((line) => line === "" || full.text.includes(line));
    checks.push({
      name: "force_full source",
      ok: forceOk,
      detail: forceOk
        ? "force_full preserved exact file lines"
        : "force_full missing original source lines",
    });
  } finally {
    resetSessionContentCache();
  }

  return checks;
}

export function runAllScenarios(): {
  scenarios: ScenarioResult[];
  recoverability: RecoverabilityCheck[];
} {
  const scenarios = [
    ...runContextPipelineScenarios(),
    runRepositoryDiscovery(),
    runLargeTestOutput(),
    runLargeLog(),
    runRelevantCodeRead(),
    runRepeatedFileRead(),
    runLargeGitDiff(),
  ];
  const recoverability = runRecoverabilityChecks();
  return { scenarios, recoverability };
}
