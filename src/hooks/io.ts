/**
 * Shared hook I/O — always fail open. Never write non-JSON to stdout.
 */
export async function readStdinJson<T = Record<string, unknown>>(): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {} as T;
  return JSON.parse(raw) as T;
}

export function writeJson(payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

export function failOpen(): void {
  writeJson({});
}

export function runHook(handler: (input: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>): void {
  void (async () => {
    try {
      const input = await readStdinJson<Record<string, unknown>>();
      const out = await handler(input);
      writeJson(out ?? {});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[cursory-hook] fail-open: ${message}`);
      failOpen();
    }
  })();
}

export function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
