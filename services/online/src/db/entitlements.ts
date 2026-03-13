import { PLAN_DEFAULTS, planToDbRow, type PlanId } from "../lib/plans";
import { nowEpoch } from "../lib/time";

export interface EntitlementRow {
  workspace_id: string;
  plan: string;
  status: string;
  active_forms_limit: number;
  monthly_responses_limit: number;
  total_forms_limit: number;
  file_upload_enabled: number;
  file_storage_limit_bytes: number;
  export_enabled: number;
  password_protection: number;
  link_expiration: number;
  custom_domain: number;
  remove_branding: number;
  scheduled_close: number;
  webhook_notification: number;
  audit_log: number;
  team_seats_limit: number;
  current_period_start: number | null;
  current_period_end: number | null;
  updated_at: number;
}

/**
 * Get entitlements for a workspace. If none exist, create Free defaults.
 */
export async function getEntitlements(
  db: D1Database,
  workspaceId: string,
): Promise<EntitlementRow> {
  const row = await db
    .prepare("SELECT * FROM entitlements WHERE workspace_id = ?")
    .bind(workspaceId)
    .first<EntitlementRow>();

  if (row) return row;

  // Auto-provision free entitlements
  return ensureFreeEntitlements(db, workspaceId);
}

/**
 * Insert Free-tier entitlements for a workspace (idempotent).
 */
export async function ensureFreeEntitlements(
  db: D1Database,
  workspaceId: string,
): Promise<EntitlementRow> {
  const now = nowEpoch();
  const defaults = planToDbRow(PLAN_DEFAULTS.free);

  await db
    .prepare(
      `INSERT OR IGNORE INTO entitlements (
        workspace_id, plan, status,
        active_forms_limit, monthly_responses_limit, total_forms_limit,
        file_upload_enabled, file_storage_limit_bytes,
        export_enabled, password_protection, link_expiration,
        custom_domain, remove_branding, scheduled_close,
        webhook_notification, audit_log, team_seats_limit,
        current_period_start, current_period_end, updated_at
      ) VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
    )
    .bind(
      workspaceId,
      defaults.plan,
      defaults.active_forms_limit,
      defaults.monthly_responses_limit,
      defaults.total_forms_limit,
      defaults.file_upload_enabled,
      defaults.file_storage_limit_bytes,
      defaults.export_enabled,
      defaults.password_protection,
      defaults.link_expiration,
      defaults.custom_domain,
      defaults.remove_branding,
      defaults.scheduled_close,
      defaults.webhook_notification,
      defaults.audit_log,
      defaults.team_seats_limit,
      now,
    )
    .run();

  // Re-read to return consistent data
  const row = await db
    .prepare("SELECT * FROM entitlements WHERE workspace_id = ?")
    .bind(workspaceId)
    .first<EntitlementRow>();

  return row!;
}

/**
 * Update entitlements when subscription changes (called from webhook handler).
 */
export async function updateEntitlements(
  db: D1Database,
  workspaceId: string,
  plan: PlanId,
  status: string,
  currentPeriodStart: number | null,
  currentPeriodEnd: number | null,
): Promise<void> {
  const defaults = planToDbRow(PLAN_DEFAULTS[plan]);
  const now = nowEpoch();

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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        plan = excluded.plan,
        status = excluded.status,
        active_forms_limit = excluded.active_forms_limit,
        monthly_responses_limit = excluded.monthly_responses_limit,
        total_forms_limit = excluded.total_forms_limit,
        file_upload_enabled = excluded.file_upload_enabled,
        file_storage_limit_bytes = excluded.file_storage_limit_bytes,
        export_enabled = excluded.export_enabled,
        password_protection = excluded.password_protection,
        link_expiration = excluded.link_expiration,
        custom_domain = excluded.custom_domain,
        remove_branding = excluded.remove_branding,
        scheduled_close = excluded.scheduled_close,
        webhook_notification = excluded.webhook_notification,
        audit_log = excluded.audit_log,
        team_seats_limit = excluded.team_seats_limit,
        current_period_start = excluded.current_period_start,
        current_period_end = excluded.current_period_end,
        updated_at = excluded.updated_at`,
    )
    .bind(
      workspaceId,
      defaults.plan,
      status,
      defaults.active_forms_limit,
      defaults.monthly_responses_limit,
      defaults.total_forms_limit,
      defaults.file_upload_enabled,
      defaults.file_storage_limit_bytes,
      defaults.export_enabled,
      defaults.password_protection,
      defaults.link_expiration,
      defaults.custom_domain,
      defaults.remove_branding,
      defaults.scheduled_close,
      defaults.webhook_notification,
      defaults.audit_log,
      defaults.team_seats_limit,
      currentPeriodStart,
      currentPeriodEnd,
      now,
    )
    .run();
}
