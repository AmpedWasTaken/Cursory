#!/usr/bin/env node
import { persistSessionStats } from "../core/telemetry/sessionStats.js";
import { runHook } from "./io.js";

runHook((_input) => {
  try {
    persistSessionStats();
  } catch {
    // fail open
  }
  // Keep any returned context tiny if the host merges it.
  return {};
});
