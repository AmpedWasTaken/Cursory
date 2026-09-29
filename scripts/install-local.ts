/**
 * Copy Cursory into ~/.cursor/plugins/local/cursory for local Cursor discovery.
 *
 * Cursor only follows symlinks whose targets stay inside plugins/local, so this
 * script copies files instead of linking the development repository.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(__dirname, "..");
const targetRoot = join(homedir(), ".cursor", "plugins", "local", "cursory");

const REQUIRED_DIST = [join(repoRoot, "dist", "index.js"), join(repoRoot, "dist", "extension.js")];

const COPY_ENTRIES = [
  ".cursor-plugin",
  "mcp.json",
  "package.json",
  "pnpm-lock.yaml",
  "dist",
  "media",
  "README.md",
  "LICENSE",
  "cursory.config.example.json",
  "rules",
  "skills",
  "commands",
  "hooks",
  "docs",
] as const;

function assertBuilt(): void {
  if (REQUIRED_DIST.some((path) => !existsSync(path))) {
    console.error(
      "Missing compiled Cursory entry points. Run `pnpm build` before `pnpm install:local`.",
    );
    process.exit(1);
  }
}

function copyEntry(name: string): void {
  const from = join(repoRoot, name);
  if (!existsSync(from)) {
    console.warn(`skip missing: ${name}`);
    return;
  }
  const to = join(targetRoot, name);
  cpSync(from, to, { recursive: true, dereference: true });
}

/**
 * Copying the development `node_modules` cannot work: pnpm resolves transitive
 * dependencies through symlinks under `.pnpm`, and a dereferenced copy turns
 * every package into a real directory whose transitive deps are unreachable.
 * Install production dependencies in the target with a hoisted layout instead.
 */
function installRuntimeDependencies(): void {
  const isWindows = process.platform === "win32";
  execFileSync(
    isWindows ? "pnpm.cmd" : "pnpm",
    [
      "install",
      "--prod",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--node-linker=hoisted",
      "--config.confirmModulesPurge=false",
    ],
    // Node refuses to spawn .cmd shims without a shell since v20.
    { cwd: targetRoot, stdio: "inherit", shell: isWindows },
  );
}

/** Cursor keeps a handle on the plugin directory, so empty it instead of removing it. */
function clearTarget(): void {
  if (!existsSync(targetRoot)) {
    return;
  }
  for (const entry of readdirSync(targetRoot)) {
    rmSync(join(targetRoot, entry), {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
}

function main(): void {
  assertBuilt();
  mkdirSync(join(homedir(), ".cursor", "plugins", "local"), { recursive: true });
  clearTarget();
  mkdirSync(targetRoot, { recursive: true });

  for (const entry of COPY_ENTRIES) {
    copyEntry(entry);
  }

  installRuntimeDependencies();

  writeFileSync(
    join(targetRoot, ".cursory-install.json"),
    JSON.stringify(
      {
        installedAt: new Date().toISOString(),
        source: repoRoot,
        target: targetRoot,
        note: "Local development copy. Reload Cursor window after install.",
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`Cursory installed to:\n  ${targetRoot}`);
  console.log("Next: Developer: Reload Window, then check Customize for cursory.");
}

main();
