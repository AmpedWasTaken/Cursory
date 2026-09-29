import { basename, extname } from "node:path";
import { LANGUAGE_EXTENSIONS } from "../config/defaults.js";

export type FileKind =
  | "source"
  | "manifest"
  | "config"
  | "test"
  | "docs"
  | "log"
  | "generated"
  | "binary"
  | "lockfile"
  | "other";

const TAIL_EXTENSIONS = new Set([".log", ".jsonl", ".out", ".err"]);

export interface ClassifiedFile {
  kind: FileKind;
  language: string | null;
}

const MANIFEST_NAMES = new Set([
  "package.json",
  "cargo.toml",
  "go.mod",
  "pyproject.toml",
  "requirements.txt",
  "composer.json",
  "gemfile",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "pnpm-workspace.yaml",
]);

const LOCK_NAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "cargo.lock",
  "composer.lock",
  "bun.lockb",
  "poetry.lock",
]);

const CONFIG_NAMES = new Set([
  "tsconfig.json",
  "jsconfig.json",
  "eslint.config.js",
  "eslint.config.mjs",
  "vitest.config.ts",
  "vite.config.ts",
  "webpack.config.js",
  "tailwind.config.js",
  "tailwind.config.ts",
  "docker-compose.yml",
  "dockerfile",
  ".env",
  ".env.example",
]);

export function prefersExactTail(pathLike: string): boolean {
  const posix = pathLike.replace(/\\/g, "/");
  const ext = extname(posix).toLowerCase();
  if (TAIL_EXTENSIONS.has(ext)) return true;
  return /(^|\/)logs?\//i.test(posix) && !LANGUAGE_EXTENSIONS[ext];
}

export function classifyFile(relativePosixPath: string): ClassifiedFile {
  const base = basename(relativePosixPath).toLowerCase();
  const ext = extname(relativePosixPath).toLowerCase();
  const language = LANGUAGE_EXTENSIONS[ext] ?? null;

  if (prefersExactTail(relativePosixPath)) {
    return { kind: "log", language: null };
  }
  if (LOCK_NAMES.has(base)) {
    return { kind: "lockfile", language: null };
  }
  if (MANIFEST_NAMES.has(base)) {
    return { kind: "manifest", language: null };
  }
  if (CONFIG_NAMES.has(base) || base.endsWith(".config.js") || base.endsWith(".config.ts")) {
    return { kind: "config", language };
  }
  if (
    relativePosixPath.includes("/__tests__/") ||
    relativePosixPath.includes("/test/") ||
    relativePosixPath.includes("/tests/") ||
    /\.(test|spec)\.[cm]?[jt]sx?$/i.test(base)
  ) {
    return { kind: "test", language };
  }
  if (ext === ".md" || relativePosixPath.startsWith("docs/") || base === "readme.md") {
    return { kind: "docs", language: language ?? "Markdown" };
  }
  if (
    ext === ".map" ||
    base.endsWith(".min.js") ||
    base.endsWith(".min.css") ||
    relativePosixPath.includes("/generated/")
  ) {
    return { kind: "generated", language };
  }
  if (
    [
      ".png",
      ".jpg",
      ".jpeg",
      ".gif",
      ".webp",
      ".ico",
      ".exe",
      ".dll",
      ".so",
      ".dylib",
      ".wasm",
      ".zip",
      ".gz",
      ".pdf",
    ].includes(ext)
  ) {
    return { kind: "binary", language: null };
  }
  if (language) {
    return { kind: "source", language };
  }
  return { kind: "other", language: null };
}

export function isProbablySource(kind: FileKind): boolean {
  return kind === "source" || kind === "test" || kind === "manifest" || kind === "config";
}
