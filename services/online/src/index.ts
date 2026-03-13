import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env";
import type { AuthContext } from "./middleware/auth";
import type { EntitlementRow } from "./db/entitlements";
import { getCurrentPeriodUsage } from "./db/quota";
import { requireAuth } from "./middleware/auth";
import { loadEntitlements } from "./middleware/entitlements";
import { forms } from "./routes/forms";
import { pub } from "./routes/public";
import { results } from "./routes/results";
import { internal } from "./routes/internal";
import { tokens } from "./routes/tokens";
import { webhooks } from "./routes/webhooks";

type AppVars = {
  auth: AuthContext;
  entitlements: EntitlementRow;
};

const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

// ── Global middleware ────────────────────────────────────────────────
app.use("/api/*", async (c, next) => {
  const allowedOrigins = parseAllowedOrigins(c.env);
  const middleware = cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : [],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "X-Dev-User-Id",
      "X-Dev-Workspace-Id",
    ],
  });
  return middleware(c, next);
});

// CORS for public form endpoints — open to all origins by design
app.use(
  "/f/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
    allowHeaders: ["Content-Type", "X-Turnstile-Token"],
  }),
);

// ── Health check ─────────────────────────────────────────────────────
app.get("/", (c) => c.json({ service: "clawcollect-online", status: "ok" }));
app.get("/health", (c) => c.json({ status: "ok" }));

// ── Authenticated API routes ─────────────────────────────────────────
const api = new Hono<{ Bindings: Env; Variables: AppVars }>();
api.use("*", requireAuth, loadEntitlements);
api.route("/forms", forms);
api.route("/tokens", tokens);

// Usage endpoint
api.get("/usage", async (c) => {
  const auth = c.get("auth");
  const entitlements = c.get("entitlements");
  const db = c.env.DB;

  const activeForms = await db
    .prepare(
      "SELECT COUNT(*) as cnt FROM forms WHERE workspace_id = ? AND status IN ('draft', 'active')",
    )
    .bind(auth.workspaceId)
    .first<{ cnt: number }>();

  const periodUsage = await getCurrentPeriodUsage(
    db,
    auth.workspaceId,
    entitlements.current_period_start,
    entitlements.current_period_end,
  );

  return c.json({
    plan: entitlements.plan,
    status: entitlements.status,
    active_forms: {
      current: activeForms?.cnt ?? 0,
      limit: entitlements.active_forms_limit,
    },
    monthly_responses: {
      current: periodUsage.responses_count,
      limit: entitlements.monthly_responses_limit,
    },
    forms_created_this_period: {
      current: periodUsage.forms_created_count,
      limit: entitlements.total_forms_limit,
    },
  });
});

// Entitlements query
api.get("/entitlements", (c) => {
  const entitlements = c.get("entitlements");
  return c.json({ entitlements });
});

app.route("/api", api);

// ── Public routes (no auth) ──────────────────────────────────────────
app.route("/f", pub);
app.route("/r", results);

// ── Webhook routes (no auth, uses signature verification) ────────────
app.route("/webhooks", webhooks);

// ── Internal service routes (secret-protected) ───────────────────────
app.route("/internal", internal);

export default app;

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Parse ALLOWED_ORIGINS env var into an array.
 * In development mode, also allows localhost origins.
 */
function parseAllowedOrigins(env: Env): string[] {
  const origins: string[] = [];

  if (env.ALLOWED_ORIGINS) {
    origins.push(
      ...env.ALLOWED_ORIGINS.split(",")
        .map((o) => o.trim())
        .filter(Boolean),
    );
  }

  // In development, always allow localhost
  if (env.ENVIRONMENT === "development") {
    origins.push("http://localhost:5173", "http://localhost:8787", "http://localhost:3000");
  }

  return origins;
}
