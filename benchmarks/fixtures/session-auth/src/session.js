/**
 * Deliberately buggy session gate for Cursory Agent benchmarks.
 * Expired sessions currently fall through instead of redirecting to login.
 */

/**
 * @param {{ token?: string, expiresAt?: number } | null | undefined} session
 * @param {number} [now]
 * @returns {{ ok: true, userId: string } | { ok: false, redirect: string }}
 */
export function requireSession(session, now = Date.now()) {
  if (!session || !session.token) {
    return { ok: false, redirect: "/login" };
  }

  // BUG: expired sessions are treated as valid.
  // Fix: if session.expiresAt <= now, return { ok: false, redirect: "/login" }.
  return { ok: true, userId: session.token };
}
