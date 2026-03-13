import { Hono } from "hono";
import type { Env } from "../env";
import type { AuthContext } from "../middleware/auth";
import type { EntitlementRow } from "../db/entitlements";
import { requireRole } from "../middleware/role";
import { generateId } from "../lib/id";
import { nowEpoch } from "../lib/time";

type TokenVars = {
  auth: AuthContext;
  entitlements: EntitlementRow;
};

const tokens = new Hono<{ Bindings: Env; Variables: TokenVars }>();

/** SHA-256 hex hash. */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Generate a random API token (32 bytes hex, prefixed). */
function generateApiToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `cc_tok_${hex}`;
}

// All token management requires owner or admin role
tokens.use("*", requireRole("owner", "admin"));

// ── POST /api/tokens ── Create a new API token ──────────────────────
tokens.post("/", async (c) => {
  const auth = c.get("auth");
  const db = c.env.DB;

  const body = await c.req.json<{ name?: string; expires_at?: number }>();
  const name = body.name?.trim() || "Untitled token";

  const plaintext = generateApiToken();
  const tokenHash = await sha256Hex(plaintext);
  const tokenId = generateId("tok");
  const now = nowEpoch();

  await db
    .prepare(
      `INSERT INTO api_tokens (id, workspace_id, created_by, name, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      tokenId,
      auth.workspaceId,
      auth.userId,
      name,
      tokenHash,
      body.expires_at ?? null,
      now,
    )
    .run();

  // Plaintext is returned ONLY here, never again
  return c.json(
    {
      id: tokenId,
      token: plaintext,
      name,
      created_at: now,
      expires_at: body.expires_at ?? null,
    },
    201,
  );
});

// ── GET /api/tokens ── List tokens for workspace ────────────────────
tokens.get("/", async (c) => {
  const auth = c.get("auth");
  const db = c.env.DB;

  const result = await db
    .prepare(
      `SELECT id, name, created_by, last_used_at, expires_at, revoked, created_at
       FROM api_tokens
       WHERE workspace_id = ? AND revoked = 0
       ORDER BY created_at DESC`,
    )
    .bind(auth.workspaceId)
    .all();

  return c.json({ tokens: result.results ?? [] });
});

// ── DELETE /api/tokens/:id ── Revoke a token ────────────────────────
tokens.delete("/:id", async (c) => {
  const auth = c.get("auth");
  const tokenId = c.req.param("id");
  const db = c.env.DB;

  const existing = await db
    .prepare("SELECT id FROM api_tokens WHERE id = ? AND workspace_id = ?")
    .bind(tokenId, auth.workspaceId)
    .first<{ id: string }>();

  if (!existing) {
    return c.json({ error: "Token not found" }, 404);
  }

  await db
    .prepare("UPDATE api_tokens SET revoked = 1 WHERE id = ?")
    .bind(tokenId)
    .run();

  return c.json({ ok: true, id: tokenId, revoked: true });
});

export { tokens };
