import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

// Keep raw dumps and telemetry out of the real per-user Cursory data dir.
const dataDir = mkdtempSync(join(tmpdir(), "cursory-test-"));
process.env.CURSORY_DATA_DIR = dataDir;

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});
