import type {
  ClawCollectBoundaryKind,
  ClawCollectPluginConfig,
  ClawCollectRiskLevel,
} from "./types.js";

export type PolicyEvaluation =
  | { status: "ok"; reason?: "ok" }
  | {
      status: "warn";
      detail: string;
      reason:
        | "blocked_boundary"
        | "outside_allowlist"
        | "unsafe_scope"
        | "requires_approval";
    }
  | {
      status: "blocked";
      detail: string;
      reason:
        | "blocked_boundary"
        | "outside_allowlist"
        | "unsafe_scope"
        | "requires_approval";
    };

export type ClawCollectPolicyInput = {
  subject: string;
  boundary: ClawCollectBoundaryKind;
  risk?: ClawCollectRiskLevel;
  approved?: boolean;
  scopeKey?: string;
};

export const DEFAULT_ALLOWED_BOUNDARIES: ClawCollectBoundaryKind[] = [
  "informational",
  "reminder_only",
  "organizational",
  "sensitive",
];

export const DEFAULT_BLOCKED_BOUNDARIES: ClawCollectBoundaryKind[] = ["transactional"];

function resolveChatKind(scopeKey?: string): "direct" | "group" | "channel" | undefined {
  const raw = scopeKey?.trim();
  if (!raw) {
    return undefined;
  }
  const match = raw.match(/^[^:]+:[^:]+:(direct|group|channel):/);
  if (!match) {
    return undefined;
  }
  return match[1] as "direct" | "group" | "channel";
}

export function evaluateClawCollectPolicy(
  pluginConfig: ClawCollectPluginConfig,
  input: ClawCollectPolicyInput,
): PolicyEvaluation {
  const mode = pluginConfig.policy?.mode ?? "enforce";
  const allowed = new Set(
    pluginConfig.policy?.allowBoundaries?.length
      ? pluginConfig.policy.allowBoundaries
      : DEFAULT_ALLOWED_BOUNDARIES,
  );
  const blocked = new Set(
    pluginConfig.policy?.blockBoundaries?.length
      ? pluginConfig.policy.blockBoundaries
      : DEFAULT_BLOCKED_BOUNDARIES,
  );
  const requireApproval = new Set(pluginConfig.policy?.requireApprovalBoundaries ?? []);

  if (blocked.has(input.boundary)) {
    return mode === "warn"
        ? {
            status: "warn",
            detail: `${input.subject} boundary ${input.boundary} is blocked by policy`,
            reason: "blocked_boundary",
          }
        : {
            status: "blocked",
            detail: `${input.subject} boundary ${input.boundary} is blocked by policy`,
            reason: "blocked_boundary",
          };
  }

  if (!allowed.has(input.boundary)) {
    return mode === "warn"
        ? {
            status: "warn",
            detail: `${input.subject} boundary ${input.boundary} is outside allow list`,
            reason: "outside_allowlist",
          }
        : {
            status: "blocked",
            detail: `${input.subject} boundary ${input.boundary} is outside allow list`,
            reason: "outside_allowlist",
          };
  }

  if (input.boundary === "sensitive") {
    const chatKind = resolveChatKind(input.scopeKey);
    if (chatKind && chatKind !== "direct") {
      return mode === "warn"
        ? {
            status: "warn",
            detail: `${input.subject} boundary sensitive requires a protected direct chat; shared chat scope ${chatKind} is not allowed`,
            reason: "unsafe_scope",
          }
        : {
            status: "blocked",
            detail: `${input.subject} boundary sensitive requires a protected direct chat; shared chat scope ${chatKind} is not allowed`,
            reason: "unsafe_scope",
          };
    }

    if (input.approved !== true) {
      return mode === "warn"
        ? {
            status: "warn",
            detail: `${input.subject} boundary sensitive requires explicit approval in the protected chat before capture or routing`,
            reason: "requires_approval",
          }
        : {
            status: "blocked",
            detail: `${input.subject} boundary sensitive requires explicit approval in the protected chat before capture or routing`,
            reason: "requires_approval",
          };
    }
  }

  if (requireApproval.has(input.boundary) && input.approved !== true) {
    return mode === "warn"
      ? {
          status: "warn",
          detail: `${input.subject} boundary ${input.boundary} requires approval`,
          reason: "requires_approval",
        }
      : {
          status: "blocked",
          detail: `${input.subject} boundary ${input.boundary} requires approval`,
          reason: "requires_approval",
        };
  }

  return { status: "ok", reason: "ok" };
}
