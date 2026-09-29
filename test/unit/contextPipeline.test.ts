import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CONTEXT_BUDGETS,
  selectByContextRoi,
} from "../../src/context/ContextBudget.js";
import {
  createSummaryCacheKey,
  getContextCache,
  resetContextCache,
} from "../../src/context/ContextCache.js";
import { buildOptimizedContext } from "../../src/context/ContextPipeline.js";
import {
  conversationRelevance,
  selectConversationContext,
  type ConversationMessage,
} from "../../src/context/ConversationSelector.js";
import {
  detectDuplicateBlocks,
  normalizeForComparison,
} from "../../src/context/DuplicateDetector.js";
import { estimateTokens } from "../../src/context/TokenEstimator.js";
import { novelContext } from "../../src/mcp/registerTools.js";

const fixtureRoot = join(process.cwd(), "test/fixtures/mini-repo");

function messages(): ConversationMessage[] {
  const oldNoise =
    "We discussed documentation typography, README badges, release colors, " +
    "marketing screenshots, and unrelated deployment notes. ".repeat(30);
  return [
    { id: "1", role: "user", content: oldNoise, source: "user" },
    {
      id: "2",
      role: "assistant",
      content:
        "The refreshToken method in PaymentService rejects expired sessions before retrying.",
      source: "cursor",
    },
    {
      id: "3",
      role: "user",
      content: "Keep the existing retry limit and do not rename refreshToken.",
      source: "user",
    },
  ];
}

describe("context duplication detection", () => {
  it("detects exact, normalized, fenced, and fuzzy duplicates", () => {
    const source = "export function refreshToken() {\n  return retry();\n}";
    const result = detectDuplicateBlocks(
      [
        source,
        "```ts\nexport   function refreshToken() {\n return retry();\n}\n```",
        `${source}\n// a small novel note`,
      ],
      [source],
    );
    expect(result.duplicates.length).toBeGreaterThanOrEqual(2);
    expect(result.duplicateTokens).toBeGreaterThan(0);
  });

  it("normalizes wrappers without treating them as useful source", () => {
    expect(
      normalizeForComparison(
        "[CURSORY_CONTEXT]\r\n```ts\r\nconst value = 1;\r\n```\r\n[/CURSORY_CONTEXT]",
      ),
    ).toBe("const value = 1;");
  });

  it("does not return one file as both full text and repeated summary", () => {
    const file = readFileSync(
      join(fixtureRoot, "src/lib/PaymentService.ts"),
      "utf8",
    );
    const result = detectDuplicateBlocks(
      [file, file.replace(/\s+/g, " ")],
      [],
    );
    expect(result.unique).toHaveLength(1);
    expect(result.duplicates).toHaveLength(1);
  });
});

describe("conversation selection and recursive-growth prevention", () => {
  beforeEach(() => resetContextCache());

  it("preserves recent relevant context and discards old irrelevant context", () => {
    const result = selectConversationContext({
      messages: messages(),
      currentPrompt: "Fix the PaymentService refreshToken retry bug",
      recentBudget: 500,
      historicalBudget: 200,
    });
    expect(result.recent.map((message) => message.id)).toEqual(["2", "3"]);
    expect(result.recent[0]?.content).toContain("refreshToken");
    expect(result.historicalSummary).not.toContain("typography");
    expect(result.skippedIrrelevant).toBeGreaterThan(0);
  });

  it("never summarizes prior Cursory context", () => {
    const generated = {
      id: "generated",
      role: "assistant" as const,
      content:
        "[CURSORY_CONTEXT]\nassistant: stale recursive summary\n[/CURSORY_CONTEXT]",
      source: "cursory" as const,
      type: "summary" as const,
    };
    const result = selectConversationContext({
      messages: [...messages(), generated],
      currentPrompt: "Fix the PaymentService refreshToken retry bug",
      recentBudget: 500,
      historicalBudget: 200,
    });
    expect(result.recent.some((message) => message.id === generated.id)).toBe(
      false,
    );
    expect(result.historicalSummary).not.toContain("recursive summary");
    expect(result.skippedGenerated).toBe(1);
  });

  it("reuses an unchanged historical summary by source hash", () => {
    const input = {
      messages: messages(),
      currentPrompt: "What deployment typography choices were discussed?",
      recentBudget: 1,
      historicalBudget: 120,
    };
    const first = selectConversationContext(input);
    const second = selectConversationContext(input);
    expect(first.historicalSummary.length).toBeGreaterThan(0);
    expect(first.summaryCacheHit).toBe(false);
    expect(second.summaryCacheHit).toBe(true);
    expect(second.historicalSummary).toBe(first.historicalSummary);
    const source = messages()
      .map((message) => `${message.role}:${message.content}`)
      .join("\n");
    expect(
      createSummaryCacheKey(source, {
        maxTokens: 120,
        version: 1,
      }),
    ).toHaveLength(64);
  });

  it("scores related turns above unrelated turns", () => {
    const prompt = "Fix refreshToken retry handling";
    expect(
      conversationRelevance("refreshToken retries the API request", prompt),
    ).toBeGreaterThan(
      conversationRelevance("change README typography", prompt),
    );
  });
});

describe("strict context pipeline", () => {
  beforeEach(() => resetContextCache());

  it("keeps the user's current prompt byte-for-byte unchanged", () => {
    const prompt =
      "Fix src/lib/PaymentService.ts refreshToken(); keep retryLimit = 3.";
    const result = buildOptimizedContext({
      currentPrompt: prompt,
      messages: messages(),
      mode: "replacement",
    });
    expect(result.originalPrompt).toBe(prompt);
    expect(result.optimizedContext.startsWith(prompt)).toBe(true);
  });

  it("injects nothing when the host context is additive", () => {
    const result = buildOptimizedContext({
      currentPrompt: "Fix refreshToken",
      messages: messages(),
    });
    expect(result.injectedContext).toBe("");
    expect(result.noInjectionReason).toMatch(/additive/);
    expect(result.stats.tokensSaved).toBe(0);
  });

  it("guards the observed 12.2K to 18.2K conversation regression", () => {
    const fixture = JSON.parse(
      readFileSync(
        join(
          process.cwd(),
          "test/fixtures/conversation/observed-regression.json",
        ),
        "utf8",
      ),
    ) as {
      currentPrompt: string;
      baselinePattern: string;
      duplicatePattern: string;
      observed: {
        baselineConversationTokens: number;
        regressedConversationTokens: number;
        addedConversationTokens: number;
      };
    };
    const repeatToTokens = (pattern: string, tokens: number) =>
      pattern.repeat(Math.ceil((tokens * 4) / pattern.length));
    const baselineConversation = repeatToTokens(
      fixture.baselinePattern,
      fixture.observed.baselineConversationTokens -
        estimateTokens(fixture.currentPrompt),
    );
    const duplicatedContext = repeatToTokens(
      fixture.duplicatePattern,
      fixture.observed.addedConversationTokens,
    );
    const baselineTokens = estimateTokens(
      `${fixture.currentPrompt}\n${baselineConversation}`,
    );
    expect(baselineTokens).toBeGreaterThan(12_000);
    expect(baselineTokens).toBeLessThan(12_400);
    expect(
      estimateTokens(
        `${fixture.currentPrompt}\n${baselineConversation}\n${duplicatedContext}`,
      ),
    ).toBeGreaterThanOrEqual(
      fixture.observed.regressedConversationTokens,
    );

    const result = buildOptimizedContext({
      currentPrompt: fixture.currentPrompt,
      messages: [
        {
          id: "baseline",
          role: "assistant",
          content: baselineConversation,
          source: "cursor",
        },
      ],
      projectContext: [
        {
          id: "would-add-six-thousand",
          path: "src/generated-context.ts",
          text: duplicatedContext,
          symbols: ["task"],
        },
      ],
      mode: "additive",
    });
    expect(result.injectedContext).toBe("");
    expect(result.stats.optimizedTokens).toBeLessThanOrEqual(
      result.stats.baselineTokens,
    );
    expect(result.stats.regressionTokens).toBe(0);
  });

  it("never exceeds the configured hard token budget", () => {
    const result = selectByContextRoi(
      Array.from({ length: 20 }, (_, index) => ({
        id: String(index),
        text: `src/auth/file${index}.ts\n${"refresh token code ".repeat(300)}`,
        relevanceScore: 0.95 - index / 100,
        kind: "project" as const,
      })),
      {
        ...DEFAULT_CONTEXT_BUDGETS,
        maxInjectedTokens: 600,
        projectContextBudget: 500,
        safetyMargin: 100,
      },
    );
    expect(
      result.reduce((total, item) => total + item.estimatedTokens, 0),
    ).toBeLessThanOrEqual(500);
  });

  it("enforces the hard budget across the complete pipeline", () => {
    const result = buildOptimizedContext({
      currentPrompt: "Fix refreshToken",
      mode: "replacement",
      allowRegression: true,
      budgets: {
        maxInjectedTokens: 600,
        recentConversationBudget: 250,
        historicalSummaryBudget: 100,
        projectContextBudget: 250,
        instructionsBudget: 50,
        safetyMargin: 100,
      },
      messages: messages(),
      projectContext: Array.from({ length: 10 }, (_, index) => ({
        id: `auth-${index}`,
        path: `src/auth/refreshToken${index}.ts`,
        text: `refreshToken retry ${"implementation ".repeat(300)}`,
        symbols: ["refreshToken"],
      })),
    });
    expect(estimateTokens(result.injectedContext)).toBeLessThanOrEqual(500);
  });

  it("selects relevant code and omits a huge unrelated file", () => {
    const relevant = readFileSync(
      join(fixtureRoot, "src/lib/PaymentService.ts"),
      "utf8",
    );
    const result = buildOptimizedContext({
      currentPrompt: "Fix PaymentService refreshToken",
      mode: "replacement",
      messages: messages(),
      projectContext: [
        {
          id: "payment",
          path: "src/lib/PaymentService.ts",
          text: relevant,
          symbols: ["PaymentService", "refreshToken"],
          recentlyEdited: true,
        },
        {
          id: "readme",
          path: "docs/README-history.md",
          text: "old installation history ".repeat(3000),
          symbols: ["renderBadge"],
        },
      ],
    });
    expect(result.optimizedContext).toContain("refreshToken");
    expect(result.optimizedContext).not.toContain("old installation history");
    expect(result.stats.optimizedTokens).toBeLessThanOrEqual(
      result.stats.baselineTokens,
    );
  });

  it("keeps wrapper overhead below the instruction budget", () => {
    expect(
      estimateTokens("[CURSORY_CONTEXT]\n[/CURSORY_CONTEXT]"),
    ).toBeLessThan(150);
  });

  it("does not count a regression as savings", () => {
    const result = buildOptimizedContext({
      currentPrompt: "tiny request",
      mode: "replacement",
      allowRegression: true,
      messages: [
        {
          id: "recent",
          role: "user",
          content: "tiny request with a little extra context",
        },
      ],
    });
    expect(result.stats.tokensSaved).toBeGreaterThanOrEqual(0);
    if (result.stats.optimizedTokens > result.stats.baselineTokens) {
      expect(result.stats.tokensSaved).toBe(0);
      expect(result.stats.regressionTokens).toBeGreaterThan(0);
    }
  });

  it("emits an attribution report only when debug is enabled", () => {
    const disabled = buildOptimizedContext({
      currentPrompt: "Fix refreshToken",
      messages: messages(),
      mode: "replacement",
    });
    const enabled = buildOptimizedContext({
      currentPrompt: "Fix refreshToken",
      messages: messages(),
      mode: "replacement",
      debug: true,
    });
    expect(disabled.debug).toBeUndefined();
    expect(enabled.debug?.breakdown.originalUserPrompt).toBeGreaterThan(0);
  });

  it("does not retain generated context as future project source", () => {
    const result = buildOptimizedContext({
      currentPrompt: "Fix refreshToken",
      mode: "replacement",
      messages: messages(),
      projectContext: [
        {
          id: "recursive",
          path: "generated",
          text: "[CURSORY_CONTEXT]\nrefreshToken stale summary\n[/CURSORY_CONTEXT]",
        },
      ],
    });
    expect(result.selected.some((item) => item.id === "recursive")).toBe(false);
  });

  it("tracks delivered content hashes without storing it in messages", () => {
    const cache = getContextCache();
    cache.markDelivered("exact source");
    expect(cache.hasDelivered("exact source")).toBe(true);
    expect(cache.hasDelivered("changed source")).toBe(false);
  });

  it("does not deliver the same MCP context block twice", () => {
    const source = "path: src/auth.ts\nexport function refreshToken() {}";
    expect(novelContext(source, false, "workspace-a")).toBe(source);
    expect(novelContext(source, false, "workspace-a")).toBe(
      "[cursory:duplicate] no new context",
    );
    expect(novelContext(source, false, "workspace-b")).toBe(source);
    expect(novelContext(source, true, "workspace-a")).toBe(source);
  });
});
