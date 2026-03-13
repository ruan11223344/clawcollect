import { createMiddleware } from "hono/factory";
import type { Env } from "../env";
import type { AuthContext } from "./auth";
import type { EntitlementRow } from "../db/entitlements";

/**
 * Middleware factory that requires the authenticated user to have one of the
 * specified roles. Must be used after requireAuth.
 */
export function requireRole(...allowed: AuthContext["role"][]) {
  const allowedSet = new Set(allowed);
  return createMiddleware<{
    Bindings: Env;
    Variables: { auth: AuthContext; entitlements: EntitlementRow };
  }>(async (c, next) => {
    const auth = c.get("auth");
    if (!allowedSet.has(auth.role)) {
      return c.json(
        { error: `This action requires one of: ${allowed.join(", ")}` },
        403,
      );
    }
    return next();
  });
}
