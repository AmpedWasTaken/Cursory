export type CursoryStatus = "active" | "idle" | "optimizing" | "bypassed" | "error" | "off";
export type OptimizationMode = "conservative" | "balanced" | "aggressive";
export type SidebarView = "welcome" | "overview" | "request" | "inspector" | "settings";

export interface ContextBreakdown {
  currentPrompt: number;
  recentConversation: number;
  historicalSummary: number;
  projectContext: number;
  instructions: number;
  metadata: number;
}

export interface RelevantFile {
  path: string;
  tokens?: number;
  relevance?: number;
  reason?: string[];
  hash?: string;
  cached?: boolean;
}

export interface ContextBlock {
  id: string;
  label: string;
  source: string;
  tokens: number;
  relevance?: number;
  reasons: string[];
  hash?: string;
  cached: boolean;
  content?: string;
}

export interface DuplicateBlock {
  id: string;
  source: string;
  matched: string;
  similarity: number;
  tokensAvoided: number;
}

export interface PipelineDebug {
  selectionMs: number;
  deduplicationMs: number;
  compressionMs: number;
  budgetingMs: number;
  totalMs: number;
  candidates: number;
  selected: number;
  dropped: number;
}

export interface OptimizationRecord {
  id: string;
  timestamp: number;
  promptPreview: string;
  baselineTokens: number;
  optimizedTokens: number;
  tokensSaved: number;
  reductionPercent: number;
  duplicateTokensRemoved: number;
  irrelevantTokensRemoved: number;
  compressionSavings: number;
  bypassed: boolean;
  bypassReason?: string;
  regressionRejected?: boolean;
  attemptedOptimizedTokens?: number;
  contextBreakdown: ContextBreakdown;
  relevantFiles: RelevantFile[];
  contextBlocks?: ContextBlock[];
  duplicateBlocks?: DuplicateBlock[];
  pipeline?: PipelineDebug;
  latencyMs: number;
}

export interface SessionStats {
  requestsSeen: number;
  requestsOptimized: number;
  requestsBypassed: number;
  baselineTokens: number;
  optimizedTokens: number;
  tokensSaved: number;
  reductionPercent: number;
  duplicateTokensRemoved: number;
  irrelevantTokensRemoved: number;
  sessionStartedAt: number;
}

export interface LifetimeStats {
  requestsOptimized: number;
  baselineTokens: number;
  optimizedTokens: number;
  tokensSaved: number;
  reductionPercent: number;
}

export interface PersistedStats {
  version: 1;
  session: SessionStats;
  lifetime: LifetimeStats;
  history: OptimizationRecord[];
}

export interface CursorySettings {
  enabled: boolean;
  mode: OptimizationMode;
  statusBarDisplay: "name" | "percent" | "saved" | "hidden";
  maxContextTokens: number;
  recentConversationTokens: number;
  historicalSummaryTokens: number;
  projectContextTokens: number;
  overheadTokens: number;
  removeDuplicates: boolean;
  compressConversation: boolean;
  skipIrrelevant: boolean;
  optimizeFiles: boolean;
  reuseSummaries: boolean;
  noNegativeSavings: boolean;
  preferOpenFiles: boolean;
  useDependencies: boolean;
  includeSmallFiles: boolean;
  largeFileThreshold: number;
  maxFiles: number;
  debugEnabled: boolean;
  storeDebugContext: boolean;
}

export interface DashboardState {
  view: SidebarView;
  status: CursoryStatus;
  stats: PersistedStats;
  settings: CursorySettings;
  selectedRequestId?: string;
  onboardingComplete: boolean;
}

export type ExtensionToWebviewMessage =
  | { type: "state:update"; payload: DashboardState }
  | { type: "status:update"; payload: CursoryStatus }
  | { type: "request:detail"; payload: OptimizationRecord };

export type WebviewToExtensionMessage =
  | { type: "ready" }
  | { type: "navigate"; view: SidebarView; requestId?: string }
  | { type: "settings:update"; key: keyof CursorySettings; value: unknown }
  | {
      type: "command";
      command: "enable" | "resetSession" | "resetLifetime" | "clearHistory" | "clearCache";
    };
