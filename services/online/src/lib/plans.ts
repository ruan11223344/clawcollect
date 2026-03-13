/**
 * Plan definitions and entitlement defaults.
 * These constants are the source of truth for what each plan grants.
 */

export type PlanId = "free" | "pro" | "team";

export interface PlanEntitlements {
  plan: PlanId;
  active_forms_limit: number;
  monthly_responses_limit: number;
  total_forms_limit: number;
  file_upload_enabled: boolean;
  file_storage_limit_bytes: number;
  export_enabled: boolean;
  password_protection: boolean;
  link_expiration: boolean;
  custom_domain: boolean;
  remove_branding: boolean;
  scheduled_close: boolean;
  webhook_notification: boolean;
  audit_log: boolean;
  team_seats_limit: number;
}

const GB = 1024 * 1024 * 1024;

export const PLAN_DEFAULTS: Record<PlanId, PlanEntitlements> = {
  free: {
    plan: "free",
    active_forms_limit: 3,
    monthly_responses_limit: 100,
    total_forms_limit: 10,
    file_upload_enabled: false,
    file_storage_limit_bytes: 0,
    export_enabled: false,
    password_protection: false,
    link_expiration: false,
    custom_domain: false,
    remove_branding: false,
    scheduled_close: false,
    webhook_notification: false,
    audit_log: false,
    team_seats_limit: 1,
  },
  pro: {
    plan: "pro",
    active_forms_limit: 20,
    monthly_responses_limit: 2000,
    total_forms_limit: 200,
    file_upload_enabled: true,
    file_storage_limit_bytes: 1 * GB,
    export_enabled: true,
    password_protection: true,
    link_expiration: true,
    custom_domain: false,
    remove_branding: true,
    scheduled_close: true,
    webhook_notification: false,
    audit_log: false,
    team_seats_limit: 1,
  },
  team: {
    plan: "team",
    active_forms_limit: 100,
    monthly_responses_limit: 10000,
    total_forms_limit: 1000,
    file_upload_enabled: true,
    file_storage_limit_bytes: 10 * GB,
    export_enabled: true,
    password_protection: true,
    link_expiration: true,
    custom_domain: true,
    remove_branding: true,
    scheduled_close: true,
    webhook_notification: true,
    audit_log: true,
    team_seats_limit: 5,
  },
};

/**
 * Convert PlanEntitlements booleans to D1-compatible 0/1 integers.
 */
export function planToDbRow(plan: PlanEntitlements) {
  return {
    plan: plan.plan,
    active_forms_limit: plan.active_forms_limit,
    monthly_responses_limit: plan.monthly_responses_limit,
    total_forms_limit: plan.total_forms_limit,
    file_upload_enabled: plan.file_upload_enabled ? 1 : 0,
    file_storage_limit_bytes: plan.file_storage_limit_bytes,
    export_enabled: plan.export_enabled ? 1 : 0,
    password_protection: plan.password_protection ? 1 : 0,
    link_expiration: plan.link_expiration ? 1 : 0,
    custom_domain: plan.custom_domain ? 1 : 0,
    remove_branding: plan.remove_branding ? 1 : 0,
    scheduled_close: plan.scheduled_close ? 1 : 0,
    webhook_notification: plan.webhook_notification ? 1 : 0,
    audit_log: plan.audit_log ? 1 : 0,
    team_seats_limit: plan.team_seats_limit,
  };
}
