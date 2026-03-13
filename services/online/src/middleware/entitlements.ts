import { createMiddleware } from "hono/factory";
import type { Env } from "../env";
import { getEntitlements, type EntitlementRow } from "../db/entitlements";
import type { AuthContext } from "./auth";

/**
 * Middleware that loads entitlements for the authenticated workspace
 * and attaches them to the context.
 * Must be used after requireAuth.
 */
export const loadEntitlements = createMiddleware<{
  Bindings: Env;
  Variables: { auth: AuthContext; entitlements: EntitlementRow };
}>(async (c, next) => {
  const auth = c.get("auth");
  if (!auth) {
    return c.json({ error: "Auth required before entitlements" }, 500);
  }

  const entitlements = await getEntitlements(c.env.DB, auth.workspaceId);
  c.set("entitlements", entitlements);
  return next();
});
