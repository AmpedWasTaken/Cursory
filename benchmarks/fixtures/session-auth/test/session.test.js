import assert from "node:assert/strict";
import { test } from "node:test";
import { requireSession } from "../src/session.js";

test("missing session redirects to login", () => {
  assert.deepEqual(requireSession(null), { ok: false, redirect: "/login" });
});

test("valid session allows access", () => {
  const now = 1_000_000;
  assert.deepEqual(
    requireSession({ token: "user-1", expiresAt: now + 60_000 }, now),
    { ok: true, userId: "user-1" },
  );
});

test("expired session redirects to login", () => {
  const now = 1_000_000;
  assert.deepEqual(
    requireSession({ token: "user-1", expiresAt: now - 1 }, now),
    { ok: false, redirect: "/login" },
  );
});
