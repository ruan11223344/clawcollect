import type { EntitlementRow } from "./entitlements";
import { nowEpoch, resolveBillingPeriod } from "../lib/time";

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  current?: number;
  limit?: number;
}

/**
 * Check if workspace can create a new form.
 * Verifies both active_forms and total_forms (per period) limits.
 */
export async function checkCreateFormQuota(
  db: D1Database,
  workspaceId: string,
  entitlements: EntitlementRow,
): Promise<QuotaCheckResult> {
  if (isReadOnly(entitlements.status)) {
    return {
      allowed: false,
      reason: `Subscription status "${entitlements.status}" does not allow creating forms.`,
    };
  }

  // Check active forms count
  const activeCount = await db
    .prepare(
      "SELECT COUNT(*) as cnt FROM forms WHERE workspace_id = ? AND status IN ('draft', 'active')",
    )
    .bind(workspaceId)
    .first<{ cnt: number }>();

  const active = activeCount?.cnt ?? 0;
  if (active >= entitlements.active_forms_limit) {
    return {
      allowed: false,
      reason: "Active forms limit reached.",
      current: active,
      limit: entitlements.active_forms_limit,
    };
  }

  // Check total forms created this period
  const usage = await getCurrentPeriodUsage(
    db,
    workspaceId,
    entitlements.current_period_start,
    entitlements.current_period_end,
  );
  if (usage.forms_created_count >= entitlements.total_forms_limit) {
    return {
      allowed: false,
      reason: "Total forms creation limit reached for this billing period.",
      current: usage.forms_created_count,
      limit: entitlements.total_forms_limit,
    };
  }

  return { allowed: true };
}

/**
 * Check if a form can accept a new response submission.
 */
export async function checkSubmitResponseQuota(
  db: D1Database,
  workspaceId: string,
  entitlements: EntitlementRow,
): Promise<QuotaCheckResult> {
  if (isReadOnly(entitlements.status)) {
    return {
      allowed: false,
      reason: `Subscription status "${entitlements.status}" does not allow collecting responses.`,
    };
  }

  const usage = await getCurrentPeriodUsage(
    db,
    workspaceId,
    entitlements.current_period_start,
    entitlements.current_period_end,
  );
  if (usage.responses_count >= entitlements.monthly_responses_limit) {
    return {
      allowed: false,
      reason: "Monthly response limit reached.",
      current: usage.responses_count,
      limit: entitlements.monthly_responses_limit,
    };
  }

  return { allowed: true };
}

/**
 * Increment the forms_created_count for the current billing period.
 * Uses deterministic period boundaries.
 */
export async function incrementFormsCreated(
  db: D1Database,
  workspaceId: string,
  periodStart: number | null,
  periodEnd: number | null,
): Promise<void> {
  const { start, end } = resolveBillingPeriod(periodStart, periodEnd);

  await db
    .prepare(
      `INSERT INTO usage_counters (workspace_id, period_start, period_end, responses_count, forms_created_count)
       VALUES (?, ?, ?, 0, 1)
       ON CONFLICT(workspace_id, period_start) DO UPDATE SET
         forms_created_count = forms_created_count + 1`,
    )
    .bind(workspaceId, start, end)
    .run();
}

/**
 * Increment the responses_count for the current billing period.
 * Uses deterministic period boundaries.
 */
export async function incrementResponsesCount(
  db: D1Database,
  workspaceId: string,
  periodStart: number | null,
  periodEnd: number | null,
): Promise<void> {
  const { start, end } = resolveBillingPeriod(periodStart, periodEnd);

  await db
    .prepare(
      `INSERT INTO usage_counters (workspace_id, period_start, period_end, responses_count, forms_created_count)
       VALUES (?, ?, ?, 1, 0)
       ON CONFLICT(workspace_id, period_start) DO UPDATE SET
         responses_count = responses_count + 1`,
    )
    .bind(workspaceId, start, end)
    .run();
}

/**
 * Read the current billing period's usage counters.
 * Returns zeros if no row exists yet (nothing consumed).
 */
export async function getCurrentPeriodUsage(
  db: D1Database,
  workspaceId: string,
  periodStart: number | null,
  periodEnd: number | null,
): Promise<{ responses_count: number; forms_created_count: number }> {
  const { start } = resolveBillingPeriod(periodStart, periodEnd);

  const row = await db
    .prepare(
      "SELECT responses_count, forms_created_count FROM usage_counters WHERE workspace_id = ? AND period_start = ?",
    )
    .bind(workspaceId, start)
    .first<{ responses_count: number; forms_created_count: number }>();

  return {
    responses_count: row?.responses_count ?? 0,
    forms_created_count: row?.forms_created_count ?? 0,
  };
}

function isReadOnly(status: string): boolean {
  return status === "canceled" || status === "unpaid" || status === "paused";
}
