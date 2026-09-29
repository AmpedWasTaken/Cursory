import { getRuntimeInfo } from "../../core/config/config.js";

export interface PingResult {
  ok: true;
  message: string;
  name: string;
  version: string;
  phase: number;
  node: string;
  platform: string;
  cwd: string;
  timestamp: string;
}

/**
 * Phase 1 diagnostic tool — proves MCP wiring without optimization side effects.
 */
export function buildPingResult(): PingResult {
  const info = getRuntimeInfo();
  return {
    ok: true,
    message: "Cursory MCP server is running (Phase 9: benchmarks).",
    name: info.name,
    version: info.version,
    phase: info.phase,
    node: info.node,
    platform: info.platform,
    cwd: process.cwd(),
    timestamp: new Date().toISOString(),
  };
}

export function formatPingText(result: PingResult): string {
  return [
    `Cursory ping: ${result.message}`,
    `name=${result.name}`,
    `version=${result.version}`,
    `phase=${result.phase}`,
    `node=${result.node}`,
    `platform=${result.platform}`,
    `cwd=${result.cwd}`,
    `timestamp=${result.timestamp}`,
  ].join("\n");
}
