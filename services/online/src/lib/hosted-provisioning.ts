import { PLAN_DEFAULTS, type PlanId, planToDbRow } from "./plans";
import { generateId } from "./id";
import { nowEpoch, resolveBillingPeriod } from "./time";

export interface ProvisionWorkspaceInput {
  workspaceName: string;
  ownerEmail: string;
  ownerName?: string;
  plan?: PlanId;
  tokenName?: string;
  tokenExpiresAt?: number | null;
}

export interface ProvisionWorkspaceResult {
  userId: string;
  workspaceId: string;
  tokenId: string;
  token: string;
  workspaceName: string;
  ownerEmail: string;
  ownerName: string;
  plan: PlanId;
  tokenExpiresAt: number | null;
  createdAt: number;
}

interface ExistingUserRow {
  id: string;
  name: string;
}

/** SHA-256 hex hash. */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateApiToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `cc_tok_${hex}`;
}

function normalizeAndValidate(input: ProvisionWorkspaceInput): Required<ProvisionWorkspaceInput> {
  const workspaceName = input.workspaceName?.trim();
  const ownerEmail = input.ownerEmail?.trim().toLowerCase();
  const ownerName = input.ownerName?.trim() || workspaceName;
  const plan = input.plan ?? "free";
  const tokenName = input.tokenName?.trim() || "Hosted workspace token";
  const tokenExpiresAt = input.tokenExpiresAt ?? null;

  if (!workspaceName) {
    throw new Error("workspaceName is required");
  }

  if (!ownerEmail) {
    throw new Error("ownerEmail is required");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
    throw new Error("ownerEmail must be a valid email address");
  }

  if (!(plan in PLAN_DEFAULTS)) {
    throw new Error(`Unsupported plan: ${plan}`);
  }

  if (tokenExpiresAt !== null && (!Number.isFinite(tokenExpiresAt) || tokenExpiresAt <= nowEpoch())) {
    throw new Error("tokenExpiresAt must be a future unix epoch seconds value");
  }

  return {
    workspaceName,
    ownerEmail,
    ownerName,
    plan,
    tokenName,
    tokenExpiresAt,
  };
}

function resolveProvisionedPeriod(plan: PlanId): { start: number | null; end: number | null } {
  if (plan === "free") {
    return { start: null, end: null };
  }

  const currentMonth = resolveBillingPeriod(null, null);
  return { start: currentMonth.start, end: currentMonth.end };
}

export async function provisionHostedWorkspace(
  db: D1Database,
  input: ProvisionWorkspaceInput,
): Promise<ProvisionWorkspaceResult> {
  const normalized = normalizeAndValidate(input);
  const existingUser = await db
    .prepare("SELECT id, name FROM users WHERE email = ?")
    .bind(normalized.ownerEmail)
    .first<ExistingUserRow>();

  const createdAt = nowEpoch();
  const userId = existingUser?.id ?? generateId("usr");
  const ownerName = existingUser?.name?.trim() || normalized.ownerName;
  const workspaceId = generateId("ws");
  const tokenId = generateId("tok");
  const token = generateApiToken();
  const tokenHash = await sha256Hex(token);
  const entitlements = planToDbRow(PLAN_DEFAULTS[normalized.plan]);
  const period = resolveProvisionedPeriod(normalized.plan);

  if (!existingUser) {
    await db
      .prepare(
        `INSERT INTO users (id, email, name, created_at, last_login_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(userId, normalized.ownerEmail, ownerName, createdAt, createdAt)
      .run();
  } else {
    await db
      .prepare("UPDATE users SET last_login_at = ? WHERE id = ?")
      .bind(createdAt, userId)
      .run();
  }

  await db
    .prepare(
      `INSERT INTO workspaces (id, name, owner_id, plan, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(workspaceId, normalized.workspaceName, userId, normalized.plan, createdAt)
    .run();

  await db
    .prepare(
      `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
       VALUES (?, ?, 'owner', ?)`,
    )
    .bind(workspaceId, userId, createdAt)
    .run();

  await db
    .prepare(
      `INSERT INTO entitlements (
        workspace_id, plan, status,
        active_forms_limit, monthly_responses_limit, total_forms_limit,
        file_upload_enabled, file_storage_limit_bytes,
        export_enabled, password_protection, link_expiration,
        custom_domain, remove_branding, scheduled_close,
        webhook_notification, audit_log, team_seats_limit,
        current_period_start, current_period_end, updated_at
      ) VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      workspaceId,
      entitlements.plan,
      entitlements.active_forms_limit,
      entitlements.monthly_responses_limit,
      entitlements.total_forms_limit,
      entitlements.file_upload_enabled,
      entitlements.file_storage_limit_bytes,
      entitlements.export_enabled,
      entitlements.password_protection,
      entitlements.link_expiration,
      entitlements.custom_domain,
      entitlements.remove_branding,
      entitlements.scheduled_close,
      entitlements.webhook_notification,
      entitlements.audit_log,
      entitlements.team_seats_limit,
      period.start,
      period.end,
      createdAt,
    )
    .run();

  await db
    .prepare(
      `INSERT INTO api_tokens (id, workspace_id, created_by, name, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      tokenId,
      workspaceId,
      userId,
      normalized.tokenName,
      tokenHash,
      normalized.tokenExpiresAt,
      createdAt,
    )
    .run();

  return {
    userId,
    workspaceId,
    tokenId,
    token,
    workspaceName: normalized.workspaceName,
    ownerEmail: normalized.ownerEmail,
    ownerName,
    plan: normalized.plan,
    tokenExpiresAt: normalized.tokenExpiresAt,
    createdAt,
  };
}
