import { Hono } from "hono";
import type { Env } from "../env";
import type { AuthContext } from "../middleware/auth";
import type { EntitlementRow } from "../db/entitlements";
import { checkCreateFormQuota, incrementFormsCreated } from "../db/quota";
import { generateId, generateLinkToken } from "../lib/id";
import { nowEpoch } from "../lib/time";
import { validateSchemaDefinition } from "../lib/validation";
import { requireRole } from "../middleware/role";

type FormVars = {
  auth: AuthContext;
  entitlements: EntitlementRow;
};

/** Access types that are currently implemented and safe to create. */
const SUPPORTED_ACCESS_TYPES = new Set(["private", "expiring", "password"]);

const VALID_RESPONSE_STATUSES = new Set(["accepted", "hidden", "spam"]);

const forms = new Hono<{ Bindings: Env; Variables: FormVars }>();

// ── POST /api/forms ─────────────────────────────────────────────────
forms.post("/", async (c) => {
  const auth = c.get("auth");
  const entitlements = c.get("entitlements");
  const db = c.env.DB;

  // Quota check
  const quota = await checkCreateFormQuota(db, auth.workspaceId, entitlements);
  if (!quota.allowed) {
    return c.json({ error: quota.reason, current: quota.current, limit: quota.limit }, 403);
  }

  const body = await c.req.json<{
    title: string;
    description?: string;
    schema?: unknown[];
    settings?: Record<string, unknown>;
  }>();

  if (!body.title?.trim()) {
    return c.json({ error: "title is required" }, 400);
  }

  // Validate schema if provided
  if (body.schema !== undefined) {
    const schemaErrors = validateSchemaDefinition(body.schema);
    if (schemaErrors.length > 0) {
      return c.json({ error: "invalid_schema", field_errors: schemaErrors }, 400);
    }
  }

  const now = nowEpoch();
  const formId = generateId("frm");

  await db
    .prepare(
      `INSERT INTO forms (id, workspace_id, created_by, title, description, schema, settings, status, file_upload_enabled, responses_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', 0, 0, ?, ?)`,
    )
    .bind(
      formId,
      auth.workspaceId,
      auth.userId,
      body.title.trim(),
      body.description?.trim() ?? "",
      JSON.stringify(body.schema ?? []),
      JSON.stringify(body.settings ?? {}),
      now,
      now,
    )
    .run();

  // Increment period counter
  await incrementFormsCreated(db, auth.workspaceId, entitlements.current_period_start, entitlements.current_period_end);

  return c.json({ id: formId, status: "draft", created_at: now }, 201);
});

// ── GET /api/forms ──────────────────────────────────────────────────
forms.get("/", async (c) => {
  const auth = c.get("auth");
  const db = c.env.DB;
  const status = c.req.query("status"); // optional filter

  let query = "SELECT id, title, description, status, responses_count, created_at, updated_at, closes_at FROM forms WHERE workspace_id = ?";
  const params: unknown[] = [auth.workspaceId];

  if (status) {
    query += " AND status = ?";
    params.push(status);
  }

  query += " ORDER BY created_at DESC LIMIT 100";

  const result = await db
    .prepare(query)
    .bind(...params)
    .all();

  return c.json({ forms: result.results ?? [] });
});

// ── GET /api/forms/:id ──────────────────────────────────────────────
forms.get("/:id", async (c) => {
  const auth = c.get("auth");
  const formId = c.req.param("id");
  const db = c.env.DB;

  const form = await db
    .prepare("SELECT * FROM forms WHERE id = ? AND workspace_id = ?")
    .bind(formId, auth.workspaceId)
    .first();

  if (!form) {
    return c.json({ error: "Form not found" }, 404);
  }

  return c.json({ form });
});

// ── PATCH /api/forms/:id ────────────────────────────────────────────
forms.patch("/:id", async (c) => {
  const auth = c.get("auth");
  const formId = c.req.param("id");
  const db = c.env.DB;

  const existing = await db
    .prepare("SELECT id, status FROM forms WHERE id = ? AND workspace_id = ?")
    .bind(formId, auth.workspaceId)
    .first<{ id: string; status: string }>();

  if (!existing) {
    return c.json({ error: "Form not found" }, 404);
  }

  if (existing.status === "archived") {
    return c.json({ error: "Cannot update an archived form" }, 400);
  }

  const body = await c.req.json<{
    title?: string;
    description?: string;
    schema?: unknown[];
    settings?: Record<string, unknown>;
    closes_at?: number | null;
  }>();

  // Validate schema if provided
  if (body.schema !== undefined) {
    const schemaErrors = validateSchemaDefinition(body.schema);
    if (schemaErrors.length > 0) {
      return c.json({ error: "invalid_schema", field_errors: schemaErrors }, 400);
    }
  }

  const sets: string[] = [];
  const values: unknown[] = [];

  if (body.title !== undefined) {
    sets.push("title = ?");
    values.push(body.title.trim());
  }
  if (body.description !== undefined) {
    sets.push("description = ?");
    values.push(body.description.trim());
  }
  if (body.schema !== undefined) {
    sets.push("schema = ?");
    values.push(JSON.stringify(body.schema));
  }
  if (body.settings !== undefined) {
    sets.push("settings = ?");
    values.push(JSON.stringify(body.settings));
  }
  if (body.closes_at !== undefined) {
    sets.push("closes_at = ?");
    values.push(body.closes_at);
  }

  if (sets.length === 0) {
    return c.json({ error: "No fields to update" }, 400);
  }

  sets.push("updated_at = ?");
  values.push(nowEpoch());
  values.push(formId);
  values.push(auth.workspaceId);

  await db
    .prepare(`UPDATE forms SET ${sets.join(", ")} WHERE id = ? AND workspace_id = ?`)
    .bind(...values)
    .run();

  return c.json({ ok: true });
});

// ── POST /api/forms/:id/publish ─────────────────────────────────────
forms.post("/:id/publish", async (c) => {
  const auth = c.get("auth");
  const entitlements = c.get("entitlements");
  const formId = c.req.param("id");
  const db = c.env.DB;

  // Check subscription allows publishing
  if (
    entitlements.status === "canceled" ||
    entitlements.status === "unpaid" ||
    entitlements.status === "paused"
  ) {
    return c.json({ error: `Cannot publish: subscription is ${entitlements.status}` }, 403);
  }

  const form = await db
    .prepare("SELECT id, status FROM forms WHERE id = ? AND workspace_id = ?")
    .bind(formId, auth.workspaceId)
    .first<{ id: string; status: string }>();

  if (!form) {
    return c.json({ error: "Form not found" }, 404);
  }

  if (form.status !== "draft" && form.status !== "closed") {
    return c.json({ error: `Cannot publish form in "${form.status}" status` }, 400);
  }

  const now = nowEpoch();
  await db
    .prepare("UPDATE forms SET status = 'active', updated_at = ? WHERE id = ? AND workspace_id = ?")
    .bind(now, formId, auth.workspaceId)
    .run();

  return c.json({ ok: true, status: "active" });
});

// ── POST /api/forms/:id/close ───────────────────────────────────────
forms.post("/:id/close", async (c) => {
  const auth = c.get("auth");
  const formId = c.req.param("id");
  const db = c.env.DB;

  const form = await db
    .prepare("SELECT id, status FROM forms WHERE id = ? AND workspace_id = ?")
    .bind(formId, auth.workspaceId)
    .first<{ id: string; status: string }>();

  if (!form) {
    return c.json({ error: "Form not found" }, 404);
  }

  if (form.status !== "active") {
    return c.json({ error: `Cannot close form in "${form.status}" status` }, 400);
  }

  const now = nowEpoch();
  await db
    .prepare("UPDATE forms SET status = 'closed', updated_at = ? WHERE id = ? AND workspace_id = ?")
    .bind(now, formId, auth.workspaceId)
    .run();

  return c.json({ ok: true, status: "closed" });
});

// ── POST /api/forms/:id/results-link ────────────────────────────────
forms.post("/:id/results-link", async (c) => {
  const auth = c.get("auth");
  const formId = c.req.param("id");
  const db = c.env.DB;

  const form = await db
    .prepare("SELECT id, owner_results_token, owner_results_created_at FROM forms WHERE id = ? AND workspace_id = ?")
    .bind(formId, auth.workspaceId)
    .first<{ id: string; owner_results_token: string | null; owner_results_created_at: number | null }>();

  if (!form) {
    return c.json({ error: "Form not found" }, 404);
  }

  let token = form.owner_results_token;
  let createdAt = form.owner_results_created_at;

  if (!token) {
    token = generateLinkToken();
    createdAt = nowEpoch();
    await db
      .prepare("UPDATE forms SET owner_results_token = ?, owner_results_created_at = ?, updated_at = ? WHERE id = ?")
      .bind(token, createdAt, createdAt, formId)
      .run();
  }

  return c.json({
    token,
    url: `/r/${token}`,
    created_at: createdAt,
  });
});

// ── POST /api/forms/:id/links ───────────────────────────────────────
forms.post("/:id/links", async (c) => {
  const auth = c.get("auth");
  const entitlements = c.get("entitlements");
  const formId = c.req.param("id");
  const db = c.env.DB;

  const form = await db
    .prepare("SELECT id, status FROM forms WHERE id = ? AND workspace_id = ?")
    .bind(formId, auth.workspaceId)
    .first<{ id: string; status: string }>();

  if (!form) {
    return c.json({ error: "Form not found" }, 404);
  }

  const body = await c.req.json<{
    access_type?: string;
    password?: string;
    expires_at?: number;
    max_responses?: number;
  }>();

  const accessType = body.access_type ?? "private";

  // Reject unsupported access types
  if (!SUPPORTED_ACCESS_TYPES.has(accessType)) {
    if (accessType === "email_verified") {
      return c.json({ error: "email_verified access type is not yet implemented" }, 501);
    }
    return c.json({ error: `Unknown access type: "${accessType}"` }, 400);
  }

  // Check entitlements for advanced access types
  if (accessType === "password" && !entitlements.password_protection) {
    return c.json({ error: "Password protection requires Pro plan or above" }, 403);
  }
  if (accessType === "expiring" && !entitlements.link_expiration) {
    return c.json({ error: "Link expiration requires Pro plan or above" }, 403);
  }

  // Require password field for password links
  if (accessType === "password") {
    if (!body.password || typeof body.password !== "string" || !body.password.trim()) {
      return c.json({ error: "\"password\" field is required for password-protected links" }, 400);
    }
  }

  // Require expires_at for expiring links
  if (accessType === "expiring") {
    if (typeof body.expires_at !== "number" || body.expires_at <= nowEpoch()) {
      return c.json({ error: "\"expires_at\" must be a future Unix timestamp for expiring links" }, 400);
    }
  }

  const now = nowEpoch();
  const linkId = generateId("lnk");
  const token = generateLinkToken();

  // Hash password if provided (SHA-256 for MVP — see README for rationale)
  let passwordHash: string | null = null;
  if (accessType === "password" && body.password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(body.password);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    passwordHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  await db
    .prepare(
      `INSERT INTO form_links (id, form_id, token, access_type, password_hash, expires_at, allowed_emails, max_responses, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    )
    .bind(
      linkId,
      formId,
      token,
      accessType,
      passwordHash,
      accessType === "expiring" ? body.expires_at! : null,
      null, // allowed_emails: not supported yet
      body.max_responses ?? null,
      now,
    )
    .run();

  return c.json(
    {
      id: linkId,
      token,
      url: `/f/${token}`,
      access_type: accessType,
    },
    201,
  );
});

// ── GET /api/forms/:id/responses ─────────────────────────────────────
forms.get("/:id/responses", async (c) => {
  const auth = c.get("auth");
  const formId = c.req.param("id");
  const db = c.env.DB;

  // Verify form ownership
  const form = await db
    .prepare("SELECT id FROM forms WHERE id = ? AND workspace_id = ?")
    .bind(formId, auth.workspaceId)
    .first<{ id: string }>();

  if (!form) {
    return c.json({ error: "Form not found" }, 404);
  }

  const statusFilter = c.req.query("status");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10) || 50, 200);
  const offset = parseInt(c.req.query("offset") ?? "0", 10) || 0;

  let query = `SELECT id, form_id, link_id, data, respondent_email, status,
    created_at, COALESCE(updated_at, created_at) as updated_at
    FROM responses WHERE form_id = ?`;
  const params: unknown[] = [formId];

  if (statusFilter && VALID_RESPONSE_STATUSES.has(statusFilter)) {
    query += " AND status = ?";
    params.push(statusFilter);
  }

  query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const result = await db
    .prepare(query)
    .bind(...params)
    .all();

  // Total count for pagination
  let countQuery = "SELECT COUNT(*) as total FROM responses WHERE form_id = ?";
  const countParams: unknown[] = [formId];
  if (statusFilter && VALID_RESPONSE_STATUSES.has(statusFilter)) {
    countQuery += " AND status = ?";
    countParams.push(statusFilter);
  }
  const countRow = await db
    .prepare(countQuery)
    .bind(...countParams)
    .first<{ total: number }>();

  return c.json({
    responses: (result.results ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      data: typeof r.data === "string" ? JSON.parse(r.data as string) : r.data,
    })),
    total: countRow?.total ?? 0,
    limit,
    offset,
  });
});

// ── PATCH /api/forms/:id/responses/:responseId/moderation ────────────
forms.patch("/:id/responses/:responseId/moderation", requireRole("owner", "admin"), async (c) => {
  const auth = c.get("auth");
  const formId = c.req.param("id");
  const responseId = c.req.param("responseId");
  const db = c.env.DB;

  // Verify form ownership
  const form = await db
    .prepare("SELECT id FROM forms WHERE id = ? AND workspace_id = ?")
    .bind(formId, auth.workspaceId)
    .first<{ id: string }>();

  if (!form) {
    return c.json({ error: "Form not found" }, 404);
  }

  const body = await c.req.json<{ status: string }>();

  if (!body.status || !VALID_RESPONSE_STATUSES.has(body.status)) {
    return c.json({ error: `status must be one of: ${[...VALID_RESPONSE_STATUSES].join(", ")}` }, 400);
  }

  // Verify response belongs to this form
  const response = await db
    .prepare("SELECT id, status FROM responses WHERE id = ? AND form_id = ?")
    .bind(responseId, formId)
    .first<{ id: string; status: string }>();

  if (!response) {
    return c.json({ error: "Response not found" }, 404);
  }

  const now = nowEpoch();
  await db
    .prepare("UPDATE responses SET status = ?, updated_at = ? WHERE id = ?")
    .bind(body.status, now, responseId)
    .run();

  return c.json({ id: responseId, status: body.status, updated_at: now });
});

export { forms };
