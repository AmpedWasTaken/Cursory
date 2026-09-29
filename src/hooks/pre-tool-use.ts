#!/usr/bin/env node
import { isCursoryEnabled } from "../core/runtime/enabled.js";
import { appendLiveEvalEvent, liveEvalEventFromHook } from "../core/telemetry/liveEval.js";
import { optimizeNativeTool } from "./nativeTakeover.js";
import { runHook } from "./io.js";

/**
 * Silently bound native Read / Grep / Shell inputs.
 * Returns only `permission` and optional `updated_input` — never conversation text.
 */
runHook((input) => {
  const enabled = isCursoryEnabled();
  const out = optimizeNativeTool(input);
  const applied = Boolean(out.updated_input) && enabled;
  appendLiveEvalEvent(liveEvalEventFromHook(input, out, applied));
  if (!enabled) {
    return { permission: "allow" };
  }
  return out;
});
