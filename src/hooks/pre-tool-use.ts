#!/usr/bin/env node
import { appendLiveEvalEvent, liveEvalEventFromHook } from "../core/telemetry/liveEval.js";
import { optimizeNativeTool } from "./nativeTakeover.js";
import { runHook } from "./io.js";

/**
 * Silently bound native Read / Grep / Shell inputs.
 * Returns only `permission` and optional `updated_input` — never conversation text.
 */
runHook((input) => {
  const disable = process.env.CURSORY_DISABLE_TAKEOVER === "1";
  const out = optimizeNativeTool(input);
  const applied = Boolean(out.updated_input) && !disable;
  appendLiveEvalEvent(liveEvalEventFromHook(input, out, applied));
  if (disable) {
    return { permission: "allow" };
  }
  return out;
});
