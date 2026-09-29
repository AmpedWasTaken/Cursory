import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";

/** SHA-256 hex digest of a UTF-8 string. */
export function hashString(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** SHA-256 hex digest of a Buffer. */
export function hashBuffer(input: Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/** SHA-256 hex digest of a file (streaming for large files). */
export async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk: string | Buffer) => {
      hash.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/** Convenience: hash file contents loaded fully (small files). */
export async function hashFileContents(filePath: string): Promise<string> {
  const buf = await readFile(filePath);
  return hashBuffer(buf);
}
