import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { CURSORY_NAME, CURSORY_PHASE, CURSORY_VERSION } from "./defaults.js";

export type CursoryMode = "safe" | "balanced" | "aggressive";

export interface CursoryConfig {
  mode: CursoryMode;
  budgets: {
    workspaceMap: number;
    search: number;
    read: number;
    terminal: number;
    diff: number;
  };
  context: {
    maxInjectedTokens: number;
    recentConversationBudget: number;
    historicalSummaryBudget: number;
    projectContextBudget: number;
    instructionsBudget: number;
    safetyMargin: number;
    debug: boolean;
    allowRegression: boolean;
  };
  cache: {
    enabled: boolean;
    maxSizeMb: number;
    ttlHours: number;
  };
  terminal: {
    retainRawMinutes: number;
  };
  ignore: {
    extra: string[];
  };
  privacy: {
    telemetry: boolean;
  };
}

export const DEFAULT_CONFIG: CursoryConfig = {
  mode: "balanced",
  budgets: {
    workspaceMap: 1600,
    search: 2200,
    read: 3200,
    terminal: 2800,
    diff: 2800,
  },
  context: {
    maxInjectedTokens: 6000,
    recentConversationBudget: 2200,
    historicalSummaryBudget: 700,
    projectContextBudget: 2600,
    instructionsBudget: 150,
    safetyMargin: 300,
    debug: false,
    allowRegression: false,
  },
  cache: {
    enabled: true,
    maxSizeMb: 250,
    ttlHours: 24,
  },
  terminal: {
    retainRawMinutes: 60,
  },
  ignore: {
    extra: [],
  },
  privacy: {
    telemetry: false,
  },
};

const configSchema = z
  .object({
    mode: z.enum(["safe", "balanced", "aggressive"]).optional(),
    budgets: z
      .object({
        workspaceMap: z.number().positive().optional(),
        search: z.number().positive().optional(),
        read: z.number().positive().optional(),
        terminal: z.number().positive().optional(),
        diff: z.number().positive().optional(),
      })
      .optional(),
    context: z
      .object({
        maxInjectedTokens: z.number().positive().optional(),
        recentConversationBudget: z.number().positive().optional(),
        historicalSummaryBudget: z.number().positive().optional(),
        projectContextBudget: z.number().positive().optional(),
        instructionsBudget: z.number().positive().optional(),
        safetyMargin: z.number().nonnegative().optional(),
        debug: z.boolean().optional(),
        allowRegression: z.boolean().optional(),
      })
      .optional(),
    cache: z
      .object({
        enabled: z.boolean().optional(),
        maxSizeMb: z.number().positive().optional(),
        ttlHours: z.number().positive().optional(),
      })
      .optional(),
    terminal: z
      .object({
        retainRawMinutes: z.number().positive().optional(),
      })
      .optional(),
    ignore: z
      .object({
        extra: z.array(z.string()).optional(),
      })
      .optional(),
    privacy: z
      .object({
        telemetry: z.boolean().optional(),
      })
      .optional(),
  })
  .strict();

function deepMergeConfig(base: CursoryConfig, partial: z.infer<typeof configSchema>): CursoryConfig {
  return {
    mode: partial.mode ?? base.mode,
    budgets: { ...base.budgets, ...partial.budgets },
    context: { ...base.context, ...partial.context },
    cache: { ...base.cache, ...partial.cache },
    terminal: { ...base.terminal, ...partial.terminal },
    ignore: {
      extra: partial.ignore?.extra ?? base.ignore.extra,
    },
    privacy: { ...base.privacy, ...partial.privacy },
  };
}

/** Load cursory.config.json from workspace root if present; else defaults. */
export function loadConfig(workspaceRoot: string): CursoryConfig {
  const path = join(workspaceRoot, "cursory.config.json");
  if (!existsSync(path)) {
    return { ...DEFAULT_CONFIG, budgets: { ...DEFAULT_CONFIG.budgets }, context: { ...DEFAULT_CONFIG.context }, cache: { ...DEFAULT_CONFIG.cache }, terminal: { ...DEFAULT_CONFIG.terminal }, ignore: { extra: [] }, privacy: { ...DEFAULT_CONFIG.privacy } };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const parsed = configSchema.safeParse(raw);
    if (!parsed.success) {
      return { ...DEFAULT_CONFIG, budgets: { ...DEFAULT_CONFIG.budgets }, context: { ...DEFAULT_CONFIG.context }, cache: { ...DEFAULT_CONFIG.cache }, terminal: { ...DEFAULT_CONFIG.terminal }, ignore: { extra: [] }, privacy: { ...DEFAULT_CONFIG.privacy } };
    }
    return deepMergeConfig(DEFAULT_CONFIG, parsed.data);
  } catch {
    return { ...DEFAULT_CONFIG, budgets: { ...DEFAULT_CONFIG.budgets }, context: { ...DEFAULT_CONFIG.context }, cache: { ...DEFAULT_CONFIG.cache }, terminal: { ...DEFAULT_CONFIG.terminal }, ignore: { extra: [] }, privacy: { ...DEFAULT_CONFIG.privacy } };
  }
}

export function getRuntimeInfo(): {
  name: string;
  version: string;
  phase: number;
  node: string;
  platform: string;
} {
  return {
    name: CURSORY_NAME,
    version: CURSORY_VERSION,
    phase: CURSORY_PHASE,
    node: process.version,
    platform: process.platform,
  };
}

/** Mode-adjusted budget (aggressive lowers caps). */
export function budgetFor(
  config: CursoryConfig,
  key: keyof CursoryConfig["budgets"],
): number {
  const base = config.budgets[key];
  const hardCap = Math.max(
    1,
    config.context.maxInjectedTokens - config.context.safetyMargin,
  );
  if (config.mode === "aggressive") {
    return Math.min(hardCap, Math.floor(base * 0.7));
  }
  if (config.mode === "safe") {
    return Math.min(hardCap, Math.floor(base * 1.25));
  }
  return Math.min(hardCap, base);
}

export function resolveBudget(
  config: CursoryConfig,
  key: keyof CursoryConfig["budgets"],
  requested?: number,
): number {
  if (requested == null) return budgetFor(config, key);
  const hardCap = Math.max(
    1,
    config.context.maxInjectedTokens - config.context.safetyMargin,
  );
  return Math.min(hardCap, Math.max(1, Math.floor(requested)));
}
