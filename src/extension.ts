import * as vscode from "vscode";
import { resetContextCache } from "./context/ContextCache.js";
import { onContextOptimization } from "./context/OptimizationEvents.js";
import { CURSORY_VIEW_ID, CursoryViewProvider } from "./ui/CursoryViewProvider.js";
import { readSettings, updateSetting } from "./ui/ExtensionSettings.js";
import {
  onOptimization,
  reportContextPipelineResult,
  reportOptimization,
} from "./ui/OptimizationReporter.js";
import { StatsStore } from "./ui/StatsStore.js";
import type { CursoryStatus, OptimizationRecord, SidebarView } from "./ui/models.js";
import type { OptimizationRecordInput } from "./ui/stats.js";
import { formatCompactTokens, statusBarText } from "./ui/stats.js";

const ONBOARDING_KEY = "cursory.onboardingComplete";

export interface CursoryExtensionApi {
  recordOptimization(record: OptimizationRecordInput): void;
  setStatus(status: CursoryStatus): void;
  open(view?: SidebarView, requestId?: string): void;
}

export function activate(context: vscode.ExtensionContext): CursoryExtensionApi {
  const store = new StatsStore(context.globalState);
  let status: CursoryStatus = readSettings().enabled ? "active" : "off";
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  statusBar.name = "Cursory";
  statusBar.command = "cursory.openDashboard";

  const onboardingComplete = () => context.globalState.get<boolean>(ONBOARDING_KEY, false);

  const setStatus = (next: CursoryStatus): void => {
    status = next;
    updateStatusBar();
    void provider.refresh();
  };

  const confirm = async (message: string): Promise<boolean> =>
    (await vscode.window.showWarningMessage(message, { modal: true }, "Continue")) === "Continue";

  const provider = new CursoryViewProvider(
    context.extensionUri,
    store,
    {
      setEnabled: async (enabled) => {
        await updateSetting("enabled", enabled);
        setStatus(enabled ? "active" : "off");
      },
      resetSession: async () => {
        await store.resetSession();
        updateStatusBar();
      },
      resetLifetime: async () => {
        await store.resetLifetime();
        updateStatusBar();
      },
      clearHistory: async () => {
        await store.clearHistory();
      },
      clearCache: async () => {
        resetContextCache();
      },
      completeOnboarding: async () => {
        await context.globalState.update(ONBOARDING_KEY, true);
      },
    },
    () => status,
    onboardingComplete,
  );

  function updateStatusBar(): void {
    const settings = readSettings();
    const stats = store.snapshot().session;
    const text = statusBarText(settings.statusBarDisplay, status, stats);
    if (!text) {
      statusBar.hide();
      return;
    }
    statusBar.text = text;
    const tooltip = new vscode.MarkdownString(
      [
        "**Cursory**",
        "",
        "Current session",
        "",
        `${formatCompactTokens(stats.tokensSaved)} tokens saved  `,
        `${Math.round(stats.reductionPercent)}% context reduction  `,
        `${stats.requestsOptimized} requests optimized`,
        "",
        "Click to open Cursory",
      ].join("\n"),
    );
    tooltip.isTrusted = false;
    statusBar.tooltip = tooltip;
    statusBar.show();
  }

  const record = async (input: OptimizationRecordInput): Promise<void> => {
    try {
      const safeInput = readSettings().storeDebugContext
        ? input
        : {
            ...input,
            contextBlocks: input.contextBlocks?.map(({ content: _content, ...block }) => block),
          };
      const persisted = await store.record(safeInput);
      const latest = persisted.history[0];
      status = latest?.bypassed ? "bypassed" : "active";
      updateStatusBar();
      await provider.refresh();
    } catch (error) {
      status = "error";
      updateStatusBar();
      console.error("[cursory] Could not persist optimization statistics", error);
    }
  };

  const open = (view: SidebarView = "overview", requestId?: string): void => {
    provider.show(view, requestId);
  };

  const disposableCommands: Array<[string, () => void | Promise<void>]> = [
    ["cursory.openDashboard", () => open("overview")],
    [
      "cursory.enable",
      async () => {
        await updateSetting("enabled", true);
        setStatus("active");
      },
    ],
    [
      "cursory.disable",
      async () => {
        await updateSetting("enabled", false);
        setStatus("off");
      },
    ],
    [
      "cursory.toggle",
      async () => {
        const enabled = !readSettings().enabled;
        await updateSetting("enabled", enabled);
        setStatus(enabled ? "active" : "off");
      },
    ],
    ["cursory.showContextInspector", () => open("inspector")],
    ["cursory.showLastOptimization", () => open("request", store.snapshot().history[0]?.id)],
    [
      "cursory.resetStatistics",
      async () => {
        if (!(await confirm("Reset Cursory session and lifetime statistics?"))) return;
        await store.resetSession();
        await store.resetLifetime();
        updateStatusBar();
        await provider.refresh();
      },
    ],
    [
      "cursory.clearContextCache",
      async () => {
        if (!(await confirm("Clear Cursory's in-memory context cache?"))) return;
        resetContextCache();
      },
    ],
    [
      "cursory.runBenchmark",
      () => {
        const terminal = vscode.window.createTerminal({ name: "Cursory Benchmark" });
        terminal.sendText("pnpm benchmark");
        terminal.show();
      },
    ],
    ["cursory.openSettings", () => open("settings")],
  ];

  context.subscriptions.push(
    statusBar,
    vscode.window.registerWebviewViewProvider(CURSORY_VIEW_ID, provider),
    ...disposableCommands.map(([id, handler]) => vscode.commands.registerCommand(id, handler)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("cursory")) return;
      status = readSettings().enabled ? (status === "off" ? "active" : status) : "off";
      updateStatusBar();
      void provider.refresh();
    }),
  );

  const unsubscribe = onOptimization((optimization) => {
    void record(optimization);
  });
  const unsubscribePipeline = onContextOptimization((event) => {
    reportContextPipelineResult({
      id: event.id,
      prompt: event.prompt,
      result: event.result,
      latencyMs: event.latencyMs,
    });
  });
  context.subscriptions.push({ dispose: unsubscribe }, { dispose: unsubscribePipeline });

  updateStatusBar();
  if (!onboardingComplete()) {
    provider.show("welcome");
  }

  return {
    recordOptimization: reportOptimization,
    setStatus,
    open,
  };
}

export function deactivate(): void {
  // VS Code disposes registered resources through the extension context.
}

export type { OptimizationRecord };
