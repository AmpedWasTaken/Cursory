import { existsSync, readFileSync } from "node:fs";
import {
  formatLiveEvalSummary,
  liveEvalLogPath,
  parseLiveEvalLines,
  summarizeLiveEval,
} from "../src/core/telemetry/liveEval.js";

const path = liveEvalLogPath();
if (!existsSync(path)) {
  console.log(`No live eval log yet: ${path}`);
  console.log("Run Agent tasks with Cursory installed, then rerun pnpm eval:live.");
  process.exitCode = 0;
} else {
  const events = parseLiveEvalLines(readFileSync(path, "utf8"));
  console.log(formatLiveEvalSummary(summarizeLiveEval(events)));
  console.log("");
  console.log(`log: ${path}`);
}
