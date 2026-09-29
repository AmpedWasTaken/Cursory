/**
 * Shared enable switch for hooks + MCP during A/B benchmarks.
 *
 *   CURSORY_ENABLED=0 agent -p "..."   → baseline (Cursory off)
 *   CURSORY_ENABLED=1 agent -p "..."   → Cursory on
 *
 * Legacy: CURSORY_DISABLE_TAKEOVER=1 still disables native caps.
 */
export function isCursoryEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const enabled = env.CURSORY_ENABLED;
  if (enabled === "0" || enabled === "false" || enabled === "off") {
    return false;
  }
  if (env.CURSORY_DISABLE_TAKEOVER === "1") {
    return false;
  }
  if (enabled === "1" || enabled === "true" || enabled === "on") {
    return true;
  }
  return true;
}
