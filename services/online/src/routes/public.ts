import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../env";
import { getEntitlements } from "../db/entitlements";
import { checkSubmitResponseQuota, incrementResponsesCount } from "../db/quota";
import { renderFormPage, renderPasswordFormPage, renderStatusPage } from "../lib/html";
import { generateId } from "../lib/id";
import { nowEpoch } from "../lib/time";
import { parseSchema, validateSubmission } from "../lib/validation";

/** Returns true when the client explicitly wants JSON (API clients, smoke tests). */
function wantsJson(c: Context): boolean {
  const accept = c.req.header("Accept") ?? "";
  if (accept.includes("application/json")) return true;
  const fmt = c.req.query("format");
  if (fmt === "json") return true;
  return false;
}

const pub = new Hono<{ Bindings: Env }>();

interface FormLinkRow {
  id: string;
  form_id: string;
  token: string;
  access_type: string;
  password_hash: string | null;
  expires_at: number | null;
  allowed_emails: string | null;
  max_responses: number | null;
  is_active: number;
  created_at: number;
}

interface FormRow {
  id: string;
  workspace_id: string;
  title: string;
  description: string;
  schema: string;
  settings: string;
  status: string;
  file_upload_enabled: number;
  responses_count: number;
  closes_at: number | null;
}

/** Subscription statuses that block public access entirely. */
function isPublicBlocked(status: string): boolean {
  return status === "canceled" || status === "unpaid" || status === "paused";
}

function titleForPublicError(status: number, error: string): string {
  if (error === "Form not found or link is inactive") return "Not Found";
  if (error === "This form is no longer accepting responses.") return "Form Closed";
  if (error === "This form has reached its response limit") return "Response Limit Reached";
  if (error === "This link has expired") return "Link Expired";
  if (status === 503) return "Temporarily Unavailable";
  if (status === 410) return "Form Closed";
  return "Not Found";
}

/**
 * Shared validation for link + form + entitlements.
 * Returns the validated objects or an error response.
 */
async function validatePublicAccess(
  db: D1Database,
  token: string,
): Promise<
  | { ok: true; link: FormLinkRow; form: FormRow; workspaceId: string }
  | { ok: false; status: number; error: string }
> {
  const link = await db
    .prepare("SELECT * FROM form_links WHERE token = ? AND is_active = 1")
    .bind(token)
    .first<FormLinkRow>();

  if (!link) {
    return { ok: false, status: 404, error: "Form not found or link is inactive" };
  }

  // Check expiration
  if (link.access_type === "expiring" && link.expires_at) {
    if (nowEpoch() > link.expires_at) {
      return { ok: false, status: 410, error: "This link has expired" };
    }
  }

  // Check max responses per link
  if (link.max_responses !== null) {
    const count = await db
      .prepare("SELECT COUNT(*) as cnt FROM responses WHERE link_id = ?")
      .bind(link.id)
      .first<{ cnt: number }>();
    if ((count?.cnt ?? 0) >= link.max_responses) {
      return { ok: false, status: 410, error: "This link has reached its response limit" };
    }
  }

  const form = await db
    .prepare("SELECT * FROM forms WHERE id = ? AND status = 'active'")
    .bind(link.form_id)
    .first<FormRow>();

  if (!form) {
    return { ok: false, status: 404, error: "This form is no longer accepting responses." };
  }

  // Check scheduled close
  if (form.closes_at && nowEpoch() > form.closes_at) {
    return { ok: false, status: 410, error: "This form is no longer accepting responses." };
  }

  // Check workspace entitlements
  const entitlements = await getEntitlements(db, form.workspace_id);
  if (isPublicBlocked(entitlements.status)) {
    return { ok: false, status: 503, error: "This form is temporarily unavailable" };
  }

  return { ok: true, link, form, workspaceId: form.workspace_id };
}

/** Hash a string using SHA-256, returning hex. */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Generate a random edit token (32 bytes hex). */
function generateEditToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const EDIT_WINDOW_SECONDS = 24 * 60 * 60; // 24 hours

// ── GET /f/:token ─ Public form (HTML default, JSON on request) ─────
pub.get("/:token", async (c) => {
  const token = c.req.param("token");
  const json = wantsJson(c);

  const result = await validatePublicAccess(c.env.DB, token);
  if (!result.ok) {
    if (json) return c.json({ error: result.error }, result.status as 404);
    const title = titleForPublicError(result.status, result.error);
    return c.html(renderStatusPage(title, result.error), result.status as 404);
  }

  const { link, form, workspaceId } = result;
  const entitlements = await getEntitlements(c.env.DB, workspaceId);
  const settings = JSON.parse(form.settings) as Record<string, unknown>;
  const schema = JSON.parse(form.schema);
  const requiresPassword = link.access_type === "password";
  const branding = !entitlements.remove_branding;

  if (json) {
    return c.json({
      form: {
        title: form.title,
        description: form.description,
        schema,
        file_upload_enabled: form.file_upload_enabled === 1,
        closes_at: form.closes_at,
        allow_response_edit: !!settings.allow_response_edit,
      },
      access_type: link.access_type,
      requires_password: requiresPassword,
      branding,
    });
  }

  const pageData = {
    title: form.title,
    description: form.description ?? "",
    schema,
    branding,
    submitUrl: `/f/${token}/submit`,
    editUrlBase: `/f/${token}/responses`,
  };

  const html = requiresPassword
    ? renderPasswordFormPage(pageData)
    : renderFormPage(pageData);

  return c.html(html);
});

// ── POST /f/:token/submit ─ Submit a response ──────────────────────
pub.post("/:token/submit", async (c) => {
  const db = c.env.DB;

  const result = await validatePublicAccess(db, c.req.param("token"));
  if (!result.ok) {
    return c.json({ error: result.error }, result.status as 404);
  }

  const { link, form, workspaceId } = result;

  // Parse body exactly once
  let body: { data?: Record<string, unknown>; password?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  // Password verification (if required)
  if (link.access_type === "password" && link.password_hash) {
    if (!body.password || typeof body.password !== "string") {
      return c.json({ error: "Password required" }, 403);
    }
    const hash = await sha256Hex(body.password);
    if (hash !== link.password_hash) {
      return c.json({ error: "Invalid password" }, 403);
    }
  }

  // Validate data field
  if (!body.data || typeof body.data !== "object" || Array.isArray(body.data)) {
    return c.json({ error: "\"data\" field is required and must be an object" }, 400);
  }

  // Schema validation
  const schema = parseSchema(form.schema);
  if (schema && schema.length > 0) {
    const fieldErrors = validateSubmission(schema, body.data);
    if (fieldErrors.length > 0) {
      return c.json({ error: "validation_failed", field_errors: fieldErrors }, 400);
    }
  }

  // Quota check
  const entitlements = await getEntitlements(db, workspaceId);
  const quota = await checkSubmitResponseQuota(db, workspaceId, entitlements);
  if (!quota.allowed) {
    return c.json({ error: "This form has reached its collection limit. Please try again later." }, 429);
  }

  const now = nowEpoch();
  const responseId = generateId("rsp");

  // Truncate IP to /24 for privacy
  const ip = c.req.header("CF-Connecting-IP") ?? "";
  const truncatedIp = ip.includes(".")
    ? ip.split(".").slice(0, 3).join(".") + ".0"
    : "";

  // Edit token handling
  const settings = JSON.parse(form.settings) as Record<string, unknown>;
  const allowEdit = !!settings.allow_response_edit;
  let editToken: string | null = null;
  let editTokenHash: string | null = null;
  let editExpiresAt: number | null = null;

  if (allowEdit) {
    editToken = generateEditToken();
    editTokenHash = await sha256Hex(editToken);
    const windowSeconds = typeof settings.edit_window_seconds === "number"
      ? settings.edit_window_seconds
      : EDIT_WINDOW_SECONDS;
    editExpiresAt = now + windowSeconds;
  }

  await db
    .prepare(
      `INSERT INTO responses (id, form_id, link_id, data, respondent_ip, respondent_email, created_at, updated_at, edit_token_hash, edit_expires_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted')`,
    )
    .bind(
      responseId,
      form.id,
      link.id,
      JSON.stringify(body.data),
      truncatedIp,
      null,
      now,
      now,
      editTokenHash,
      editExpiresAt,
    )
    .run();

  // Update cached counter on form
  await db
    .prepare("UPDATE forms SET responses_count = responses_count + 1, updated_at = ? WHERE id = ?")
    .bind(now, form.id)
    .run();

  // Update period usage counter
  await incrementResponsesCount(db, workspaceId, entitlements.current_period_start, entitlements.current_period_end);

  const response: Record<string, unknown> = { id: responseId, submitted_at: now };
  if (editToken) {
    response.edit_token = editToken;
    response.edit_expires_at = editExpiresAt;
  }

  return c.json(response, 201);
});

// ── PUT /f/:token/responses/:responseId ─ Edit a response ───────────
pub.put("/:token/responses/:responseId", async (c) => {
  const db = c.env.DB;
  const token = c.req.param("token");
  const responseId = c.req.param("responseId");

  const result = await validatePublicAccess(db, token);
  if (!result.ok) {
    return c.json({ error: result.error }, result.status as 404);
  }

  const { form } = result;

  // Check form allows editing
  const settings = JSON.parse(form.settings) as Record<string, unknown>;
  if (!settings.allow_response_edit) {
    return c.json({ error: "This form does not allow response editing" }, 403);
  }

  let body: { data?: Record<string, unknown>; edit_token?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.edit_token || typeof body.edit_token !== "string") {
    return c.json({ error: "edit_token is required" }, 400);
  }

  if (!body.data || typeof body.data !== "object" || Array.isArray(body.data)) {
    return c.json({ error: "\"data\" field is required and must be an object" }, 400);
  }

  // Fetch the response
  const row = await db
    .prepare("SELECT id, form_id, edit_token_hash, edit_expires_at, status FROM responses WHERE id = ? AND form_id = ?")
    .bind(responseId, form.id)
    .first<{ id: string; form_id: string; edit_token_hash: string | null; edit_expires_at: number | null; status: string }>();

  if (!row) {
    return c.json({ error: "Response not found" }, 404);
  }

  if (!row.edit_token_hash) {
    return c.json({ error: "This response is not editable" }, 403);
  }

  // Verify edit token
  const providedHash = await sha256Hex(body.edit_token);
  if (providedHash !== row.edit_token_hash) {
    return c.json({ error: "Invalid edit token" }, 403);
  }

  // Check expiration
  if (row.edit_expires_at && nowEpoch() > row.edit_expires_at) {
    return c.json({ error: "Edit window has expired" }, 410);
  }

  // Schema validation
  const schema = parseSchema(form.schema);
  if (schema && schema.length > 0) {
    const fieldErrors = validateSubmission(schema, body.data);
    if (fieldErrors.length > 0) {
      return c.json({ error: "validation_failed", field_errors: fieldErrors }, 400);
    }
  }

  const now = nowEpoch();
  await db
    .prepare("UPDATE responses SET data = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(body.data), now, responseId)
    .run();

  return c.json({ id: responseId, updated_at: now, edited: true });
});

export { pub };
