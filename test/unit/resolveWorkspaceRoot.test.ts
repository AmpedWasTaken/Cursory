import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isPluginInstallDir,
  resolveWorkspaceRoot,
} from "../../src/core/workspace/resolveWorkspaceRoot.js";

describe("resolveWorkspaceRoot", () => {
  it("detects Cursor plugin install paths", () => {
    expect(
      isPluginInstallDir("C:/Users/me/.cursor/plugins/local/cursory"),
    ).toBe(true);
    expect(isPluginInstallDir("C:/Users/me/Documents/Github/Cursory")).toBe(false);
  });

  it("prefers an explicit usable workspace", () => {
    const root = resolveWorkspaceRoot(
      process.cwd(),
      undefined,
      {},
      "C:/Users/me/.cursor/plugins/local/cursory",
    );
    expect(root).toBe(resolve(process.cwd()));
  });

  it("uses an absolute path hint when cwd is the plugin install", () => {
    const project = join(tmpdir(), `cursory-ws-${Date.now()}`);
    mkdirSync(join(project, "src"), { recursive: true });
    writeFileSync(join(project, "package.json"), "{\"name\":\"tmp\"}\n");
    const file = join(project, "src", "app.ts");
    writeFileSync(file, "export const x = 1;\n");

    const root = resolveWorkspaceRoot(
      undefined,
      file,
      {},
      "C:/Users/me/.cursor/plugins/local/cursory",
    );
    expect(root).toBe(resolve(project));
  });

  it("prefers CURSORY_WORKSPACE over plugin cwd", () => {
    const root = resolveWorkspaceRoot(undefined, undefined, {
      CURSORY_WORKSPACE: process.cwd(),
    }, "C:/Users/me/.cursor/plugins/local/cursory");
    expect(root).toBe(resolve(process.cwd()));
  });

  it("rejects an unresolved plugin cwd without env or path", () => {
    expect(() =>
      resolveWorkspaceRoot(undefined, undefined, {}, "C:/Users/me/.cursor/plugins/local/cursory"),
    ).toThrow(/user workspace/);
  });
});
