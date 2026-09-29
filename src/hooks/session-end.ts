#!/usr/bin/env node
import { cleanupExpiredRawResults } from "../core/output/rawStore.js";
import { persistSessionStats } from "../core/telemetry/sessionStats.js";
import { runHook } from "./io.js";

runHook((_input) => {
  try {
    cleanupExpiredRawResults();
  } catch {
    // fail open
  }
  try {
    persistSessionStats();
  } catch {
    // fail open
  }
  return {};
});
