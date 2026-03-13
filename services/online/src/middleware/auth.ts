import { createMiddleware } from "hono/factory";
import type { Env } from "../env";
import { nowEpoch } from "../lib/time";

/**
 * Auth context set by the auth middleware.
 */
export interface AuthContext {
  userId: string;
  workspaceId: string;
  role: "owner" | "admin" | "member";
}

/** SHA-256 hex hash of a string. */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Authenticated API middleware.
 *
 * Auth strategies (in order):
 * 1. Dev mode: X-Dev-User-Id + X-Dev-Workspace-Id headers (ENVIRONMENT=development only)
 * 2. Bearer token: looked up in api_tokens table via SHA-256 hash
 */
export const requireAuth = createMiddleware<{
  Bindings: Env;
  Variables: { auth: AuthContext };
}>(async (c, next) => {
  // Dev mode bypass: accept X-Dev-User-Id and X-Dev-Workspace-Id headers
  if (c.env.ENVIRONMENT === "development") {
    const devUserId = c.req.header("X-Dev-User-Id");
    const devWorkspaceId = c.req.header("X-Dev-Workspace-Id");
    if (devUserId && devWorkspaceId) {
      // Auto-provision user and workspace for dev convenience
      await ensureDevUserAndWorkspace(c.env.DB, devUserId, devWorkspaceId);
      c.set("auth", { userId: devUserId, workspaceId: devWorkspaceId, role: "owner" });
      return next();
    }
  }

  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = authHeader.slice(7);
  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const tokenHash = await sha256Hex(token);
  const db = c.env.DB;

  const row = await db
    .prepare(
      `SELECT t.id, t.workspace_id, t.created_by, t.expires_at, t.revoked,
              m.role
       FROM api_tokens t
       JOIN workspace_members m ON m.workspace_id = t.workspace_id AND m.user_id = t.created_by
       WHERE t.token_hash = ?`,
    )
    .bind(tokenHash)
    .first<{
      id: string;
      workspace_id: string;
      created_by: string;
      expires_at: number | null;
      revoked: number;
      role: string;
    }>();

  if (!row) {
    return c.json({ error: "Invalid token" }, 401);
  }

  if (row.revoked) {
    return c.json({ error: "Token has been revoked" }, 401);
  }

  if (row.expires_at && nowEpoch() > row.expires_at) {
    return c.json({ error: "Token has expired" }, 401);
  }

  // Update last_used_at (fire-and-forget, don't block the request)
  c.executionCtx.waitUntil(
    db
      .prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?")
      .bind(nowEpoch(), row.id)
      .run(),
  );

  c.set("auth", {
    userId: row.created_by,
    workspaceId: row.workspace_id,
    role: row.role as AuthContext["role"],
  });
  return next();
});

/**
 * In development mode, ensure the dev user and workspace exist in D1
 * so FK constraints don't block API calls.
 */
async function ensureDevUserAndWorkspace(
  db: D1Database,
  userId: string,
  workspaceId: string,
): Promise<void> {
  const now = nowEpoch();

  await db
    .prepare(
      `INSERT OR IGNORE INTO users (id, email, name, created_at, last_login_at)
       VALUES (?, ?, 'Dev User', ?, ?)`,
    )
    .bind(userId, `${userId}@dev.local`, now, now)
    .run();

  await db
    .prepare(
      `INSERT OR IGNORE INTO workspaces (id, name, owner_id, plan, created_at)
       VALUES (?, 'Dev Workspace', ?, 'free', ?)`,
    )
    .bind(workspaceId, userId, now)
    .run();

  await db
    .prepare(
      `INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role, joined_at)
       VALUES (?, ?, 'owner', ?)`,
    )
    .bind(workspaceId, userId, now)
    .run();
}
