import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resetContextCache } from "../context/ContextCache.js";
import { buildOptimizedContext } from "../context/ContextPipeline.js";
import type { ConversationMessage } from "../context/ConversationSelector.js";
import type { ProjectContextItem } from "../context/ProjectContextSelector.js";
import type { ScenarioResult } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_MINI = join(here, "../../test/fixtures/mini-repo");
const payment = readFileSync(
  join(FIXTURE_MINI, "src/lib/PaymentService.ts"),
  "utf8",
);
const util = readFileSync(join(FIXTURE_MINI, "src/lib/util.ts"), "utf8");
const index = readFileSync(join(FIXTURE_MINI, "src/index.ts"), "utf8");
const irrelevantDocument =
  "Release documentation, screenshots, typography, deployment history, and badge colors. ".repeat(
    180,
  );

interface ContextScenario {
  name: string;
  prompt: string;
  messages: ConversationMessage[];
  project: ProjectContextItem[];
  relevantIds: string[];
}

function message(
  id: string,
  role: ConversationMessage["role"],
  content: string,
): ConversationMessage {
  return { id, role, content, source: role === "user" ? "user" : "cursor" };
}

function scenarios(): ContextScenario[] {
  return [
    {
      name: "Simple edit",
      prompt: "Update formatCurrency in src/lib/util.ts without renaming it.",
      messages: [
        message("s1", "user", "Keep the existing two-decimal output contract."),
      ],
      project: [
        {
          id: "util",
          path: "src/lib/util.ts",
          text: util,
          symbols: ["formatCurrency"],
          recentlyEdited: true,
        },
        {
          id: "docs",
          path: "docs/release-history.md",
          text: irrelevantDocument,
        },
      ],
      relevantIds: ["util"],
    },
    {
      name: "Bug fix",
      prompt: "Fix the PaymentService refreshToken retry bug.",
      messages: [
        message("b1", "assistant", "The failure occurs after an expired token."),
        message("b2", "user", "Do not change processPayment behavior."),
      ],
      project: [
        {
          id: "payment",
          path: "src/lib/PaymentService.ts",
          text: payment,
          symbols: ["PaymentService", "refreshToken", "processPayment"],
          recentlyEdited: true,
        },
        {
          id: "docs",
          path: "docs/release-history.md",
          text: irrelevantDocument,
        },
      ],
      relevantIds: ["payment"],
    },
    {
      name: "Multi-file feature",
      prompt:
        "Add PaymentService amount validation using src/lib/util.ts and wire it through src/index.ts.",
      messages: [
        message("m1", "user", "Preserve existing PaymentService exports."),
      ],
      project: [
        {
          id: "payment",
          path: "src/lib/PaymentService.ts",
          text: payment,
          symbols: ["PaymentService", "processPayment"],
        },
        {
          id: "util",
          path: "src/lib/util.ts",
          text: util,
          symbols: ["formatCurrency"],
        },
        {
          id: "index",
          path: "src/index.ts",
          text: index,
          dependencies: ["PaymentService", "util"],
        },
        {
          id: "docs",
          path: "docs/release-history.md",
          text: irrelevantDocument,
        },
      ],
      relevantIds: ["payment", "util", "index"],
    },
    {
      name: "Follow-up",
      prompt: "Apply the same refreshToken guard but keep the retry limit.",
      messages: [
        message("f0", "user", irrelevantDocument),
        message("f1", "user", "We are fixing PaymentService refreshToken."),
        message("f2", "assistant", "The retry limit is currently three attempts."),
      ],
      project: [
        {
          id: "payment",
          path: "src/lib/PaymentService.ts",
          text: payment,
          symbols: ["refreshToken"],
          recentlyEdited: true,
        },
      ],
      relevantIds: ["payment"],
    },
    {
      name: "Long conversation",
      prompt: "Finish the PaymentService refreshToken fix with retry limit three.",
      messages: [
        ...Array.from({ length: 30 }, (_, i) =>
          message(
            `old-${i}`,
            i % 2 === 0 ? "user" : "assistant",
            `Old unrelated discussion ${i}. ${irrelevantDocument}`,
          ),
        ),
        message("l1", "user", "The active bug is in PaymentService refreshToken."),
        message("l2", "assistant", "Keep retry limit three and preserve errors."),
      ],
      project: [
        {
          id: "payment",
          path: "src/lib/PaymentService.ts",
          text: payment,
          symbols: ["refreshToken"],
          recentlyEdited: true,
        },
      ],
      relevantIds: ["payment"],
    },
    {
      name: "Large codebase context",
      prompt: "Fix PaymentService refreshToken only.",
      messages: [],
      project: [
        {
          id: "payment",
          path: "src/lib/PaymentService.ts",
          text: payment,
          symbols: ["PaymentService", "refreshToken"],
          recentlyEdited: true,
        },
        ...Array.from({ length: 25 }, (_, i) => ({
          id: `unrelated-${i}`,
          path: `src/rendering/generated/Widget${i}.ts`,
          text: `export class Widget${i} {\n${"render layout frame;\n".repeat(500)}}`,
          symbols: [`Widget${i}`, "render"],
        })),
      ],
      relevantIds: ["payment"],
    },
  ];
}

export function runContextPipelineScenarios(): ScenarioResult[] {
  return scenarios().map((scenario) => {
    resetContextCache();
    const started = performance.now();
    const result = buildOptimizedContext({
      currentPrompt: scenario.prompt,
      messages: scenario.messages,
      projectContext: scenario.project,
      mode: "replacement",
    });
    const latencyMs = performance.now() - started;
    const selectedIds = new Set(result.selected.map((item) => item.id));
    const retained = scenario.relevantIds.filter((id) =>
      selectedIds.has(id),
    ).length;
    const success =
      retained === scenario.relevantIds.length &&
      result.stats.optimizedTokens <= result.stats.baselineTokens;
    return {
      name: scenario.name,
      baselineTokens: result.stats.baselineTokens,
      cursoryTokens: result.stats.optimizedTokens,
      taskSuccess: success,
      relevantItemsRetained: retained,
      relevantItemsTotal: scenario.relevantIds.length,
      latencyMs,
      detail: `${retained}/${scenario.relevantIds.length} relevant; ${latencyMs.toFixed(1)}ms`,
    };
  });
}
