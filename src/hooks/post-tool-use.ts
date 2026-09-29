#!/usr/bin/env node
import { runHook } from "./io.js";

/**
 * Observe-only metrics hook. Does not modify tool output.
 * Built-in Cursor outputs cannot be reliably replaced here.
 */
runHook((_input) => {
  return {};
});
