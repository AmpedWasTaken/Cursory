import * as vscode from "vscode";
import type { CursorySettings } from "./models.js";

const section = "cursory";

export function readSettings(): CursorySettings {
  const config = vscode.workspace.getConfiguration(section);
  return {
    enabled: config.get("enabled", true),
    mode: config.get("optimizationMode", "balanced"),
    statusBarDisplay: config.get("statusBar.display", "percent"),
    maxContextTokens: config.get("context.maxTokens", 6000),
    recentConversationTokens: config.get("context.recentConversation", 2200),
    historicalSummaryTokens: config.get("context.historicalSummary", 700),
    projectContextTokens: config.get("context.project", 2600),
    overheadTokens: config.get("context.overhead", 150),
    removeDuplicates: config.get("optimization.removeDuplicates", true),
    compressConversation: config.get("optimization.compressConversation", true),
    skipIrrelevant: config.get("optimization.skipIrrelevant", true),
    optimizeFiles: config.get("optimization.optimizeFiles", true),
    reuseSummaries: config.get("optimization.reuseSummaries", true),
    noNegativeSavings: config.get("optimization.noNegativeSavings", true),
    preferOpenFiles: config.get("files.preferOpen", true),
    useDependencies: config.get("files.useDependencies", true),
    includeSmallFiles: config.get("files.includeSmall", true),
    largeFileThreshold: config.get("files.largeFileThreshold", 500),
    maxFiles: config.get("files.maxPerRequest", 8),
    debugEnabled: config.get("debug.enabled", false),
    storeDebugContext: config.get("debug.storeContext", false),
  };
}

const settingKeys: Record<keyof CursorySettings, string> = {
  enabled: "enabled",
  mode: "optimizationMode",
  statusBarDisplay: "statusBar.display",
  maxContextTokens: "context.maxTokens",
  recentConversationTokens: "context.recentConversation",
  historicalSummaryTokens: "context.historicalSummary",
  projectContextTokens: "context.project",
  overheadTokens: "context.overhead",
  removeDuplicates: "optimization.removeDuplicates",
  compressConversation: "optimization.compressConversation",
  skipIrrelevant: "optimization.skipIrrelevant",
  optimizeFiles: "optimization.optimizeFiles",
  reuseSummaries: "optimization.reuseSummaries",
  noNegativeSavings: "optimization.noNegativeSavings",
  preferOpenFiles: "files.preferOpen",
  useDependencies: "files.useDependencies",
  includeSmallFiles: "files.includeSmall",
  largeFileThreshold: "files.largeFileThreshold",
  maxFiles: "files.maxPerRequest",
  debugEnabled: "debug.enabled",
  storeDebugContext: "debug.storeContext",
};

export async function updateSetting(key: keyof CursorySettings, value: unknown): Promise<void> {
  await vscode.workspace
    .getConfiguration(section)
    .update(settingKeys[key], value, vscode.ConfigurationTarget.Global);
}
