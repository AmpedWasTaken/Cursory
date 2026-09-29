/**
 * Basic secret redaction for metrics/logging text — not for rewriting source snippets.
 */
const PATTERNS: Array<{ re: RegExp; replace: string }> = [
  { re: /\b(api[_-]?key|apikey)\s*[:=]\s*['"]?([^\s'"]+)/gi, replace: "$1=***" },
  { re: /\b(authorization)\s*:\s*bearer\s+\S+/gi, replace: "$1: Bearer ***" },
  { re: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/g, replace: "Bearer ***" },
  { re: /\b(password|passwd|secret|token)\s*[:=]\s*['"]?([^\s'"]+)/gi, replace: "$1=***" },
  { re: /\b[A-Za-z0-9_-]*(?:SECRET|TOKEN|API_KEY)[A-Za-z0-9_-]*\s*=\s*[^\s]+/g, replace: "***" },
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const { re, replace } of PATTERNS) {
    out = out.replace(re, replace);
  }
  return out;
}
