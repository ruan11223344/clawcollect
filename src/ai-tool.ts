import type { AnyAgentTool, OpenClawPluginApi } from "openclaw/plugin-sdk";

import {
  captureFragmentForScope,
  closeCollectionForScope,
  findActiveCollection,
  getCollectionInboxForScope,
  getCollectionStatusForScope,
  getCollectionSummaryForScope,
  openCollectionForScope,
} from "./app.js";
import { evaluateClawCollectPolicy } from "./policy.js";
import { armBlockedSessionGuard, shouldBlockFollowupTools } from "./safety-guard.js";
import { loadStore } from "./storage.js";
import { resolveToolScope } from "./scope.js";
import type {
  ClawCollectBoundaryKind,
  ClawCollectPluginConfig,
  ClawCollectRiskLevel,
} from "./types.js";
import { resolveClawCollectTimeZone } from "./timezone.js";

export type ClawCollectToolContext = {
  sessionKey?: string;
  messageChannel?: string;
  agentAccountId?: string;
  requesterSenderId?: string;
};

type ClawCollectGenericParams = {
  action?: unknown;
  title?: unknown;
  limit?: unknown;
  content?: unknown;
  operation?: unknown;
  view?: unknown;
  boundary?: unknown;
  risk?: unknown;
  approved?: unknown;
};

type ClawCollectExecutionContext = {
  stateDir: string;
  scopeKey?: string;
  senderId?: string;
  timeZone?: string;
};

type ClawCollectNormalizedAction = {
  action: "status" | "capture" | "organize" | "query";
  operation?: string;
  view?: string;
};

type ClawCollectMutationPolicy = {
  boundary?: ClawCollectBoundaryKind;
  risk?: ClawCollectRiskLevel;
  approved?: boolean;
  subject: string;
  scopeKey?: string;
};

type ClawCollectBeforeToolCallResult = {
  params?: Record<string, unknown>;
  block?: boolean;
  blockReason?: string;
};

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readPositiveLimit(value: unknown, fallback = 10): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.min(50, Math.floor(value)));
  }
  return fallback;
}

function readBoundary(value: unknown): ClawCollectBoundaryKind | undefined {
  if (
    value === "informational" ||
    value === "reminder_only" ||
    value === "organizational" ||
    value === "sensitive" ||
    value === "transactional"
  ) {
    return value;
  }
  return undefined;
}

function readRisk(value: unknown): ClawCollectRiskLevel | undefined {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  return undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readOrganizeOperation(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readQueryView(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeAction(rawAction: string): ClawCollectNormalizedAction {
  switch (rawAction) {
    case "status":
    case "capture":
    case "organize":
    case "query":
      return { action: rawAction };
    default:
      return { action: "status" };
  }
}

function toolReply(text: string, details?: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function requireScope(
  scopeKey: string | undefined,
  action: string,
): { ok: true; scopeKey: string } | { ok: false; reply: ReturnType<typeof toolReply> } {
  if (scopeKey) {
    return { ok: true, scopeKey };
  }
  return {
    ok: false,
    reply: toolReply(`ClawCollect could not resolve the current chat scope for action "${action}".`, {
      ok: false,
      action,
    }),
  };
}

async function renderClawCollectStatus(
  stateDir: string,
  pluginConfig: ClawCollectPluginConfig,
  scopeKey?: string,
) {
  const store = await loadStore(stateDir, pluginConfig);
  const activeSession = scopeKey ? findActiveCollection(scopeKey, store) : undefined;

  return toolReply(
    [
      "ClawCollect status:",
      `- captures: ${store.captures.length}`,
      `- active collection here: ${activeSession ? `${activeSession.title} (${activeSession.listId})` : "none"}`,
    ].join("\n"),
    {
      ok: true,
      action: "status",
      scopeKey,
      counts: {
        captures: store.captures.length,
      },
      activeCollection: activeSession
        ? {
            id: activeSession.id,
            title: activeSession.title,
            listId: activeSession.listId,
          }
        : null,
    },
  );
}

function authorizeMutation(
  pluginConfig: ClawCollectPluginConfig,
  action: string,
  policyInput: ClawCollectMutationPolicy,
): { blockedReply?: ReturnType<typeof toolReply>; warning?: string } {
  const policy = evaluateClawCollectPolicy(pluginConfig, {
    subject: `${action}:${policyInput.subject}`,
    boundary: policyInput.boundary ?? "organizational",
    risk: policyInput.risk ?? "low",
    approved: policyInput.approved,
    scopeKey: policyInput.scopeKey,
  });

  if (policy.status === "blocked") {
    return {
      blockedReply: toolReply(`ClawCollect policy blocked ${action}: ${policy.detail}`, {
        ok: false,
        action,
        boundary: policyInput.boundary,
        risk: policyInput.risk,
        approved: policyInput.approved === true,
        policy: policy.status,
      }),
    };
  }

  if (policy.status === "warn") {
    return {
      warning: policy.detail,
    };
  }

  return {};
}

function resolveExecutionContext(
  api: OpenClawPluginApi,
  pluginConfig: ClawCollectPluginConfig,
  ctx: ClawCollectToolContext,
): ClawCollectExecutionContext {
  const scope = resolveToolScope(ctx);
  const senderId =
    readString(ctx.requesterSenderId) ??
    (scope?.chatKind === "direct" ? scope.peerId.replace(/^(user:|dm:|open_id:)/, "") : undefined);

  return {
    stateDir: api.runtime.state.resolveStateDir(),
    scopeKey: scope?.scopeKey,
    senderId,
    timeZone: resolveClawCollectTimeZone(pluginConfig, {
      scopeKey: scope?.scopeKey,
      senderId,
      channel: scope?.channel ?? ctx.messageChannel,
    }),
  };
}

export function classifyClawCollectToolCall(
  toolName: string,
  params: Record<string, unknown>,
): {
  isClawCollectTool: boolean;
  isMutating: boolean;
  action: ClawCollectNormalizedAction["action"];
  boundary?: ClawCollectBoundaryKind;
  risk?: ClawCollectRiskLevel;
  approved?: boolean;
  subject: string;
  missingBoundary: boolean;
  normalizedParams?: Record<string, unknown>;
} {
  const mapping: Record<
    string,
    { action: ClawCollectNormalizedAction["action"]; isMutating: boolean }
  > = {
    clawcollect_capture: { action: "capture", isMutating: true },
    clawcollect_organize: { action: "organize", isMutating: true },
    clawcollect_query: { action: "query", isMutating: false },
  };
  const resolved = mapping[toolName];
  if (!resolved) {
    return {
      isClawCollectTool: false,
      isMutating: false,
      action: "status",
      subject: toolName,
      missingBoundary: false,
    };
  }

  const boundary = readBoundary(params.boundary);
  const risk = readRisk(params.risk) ?? (resolved.isMutating ? "low" : undefined);
  const approved = readBoolean(params.approved);
  const subject =
    readString(params.title) ??
    readString(params.content) ??
    readString(params.operation) ??
    readString(params.view) ??
    toolName;

  return {
    isClawCollectTool: true,
    isMutating: resolved.isMutating,
    action: resolved.action,
    boundary,
    risk,
    approved,
    subject,
    missingBoundary: resolved.isMutating && !boundary,
    normalizedParams: resolved.isMutating && !readRisk(params.risk) ? { ...params, risk } : undefined,
  };
}

export function createClawCollectBeforeToolCallHandler(
  pluginConfig: ClawCollectPluginConfig,
) {
  return (
    event: { toolName: string; params: Record<string, unknown> },
    ctx: ClawCollectToolContext,
  ): ClawCollectBeforeToolCallResult | void => {
    const followupBlock = shouldBlockFollowupTools(ctx.sessionKey);
    if (followupBlock) {
      return {
        block: true,
        blockReason: followupBlock,
      };
    }

    const classification = classifyClawCollectToolCall(event.toolName, event.params);
    if (!classification.isClawCollectTool || !classification.isMutating) {
      return;
    }

    if (classification.missingBoundary) {
      return {
        block: true,
        blockReason:
          "ClawCollect mutating tools must include an explicit boundary (informational, reminder_only, organizational, sensitive, transactional).",
      };
    }

    const policy = evaluateClawCollectPolicy(pluginConfig, {
      subject: `${event.toolName}:${classification.subject}`,
      boundary: classification.boundary ?? "organizational",
      risk: classification.risk ?? "low",
      approved: classification.approved,
      scopeKey: resolveToolScope(ctx)?.scopeKey,
    });

    if (policy.status === "blocked") {
      if (
        classification.boundary === "transactional" ||
        (classification.boundary === "sensitive" && policy.reason === "unsafe_scope")
      ) {
        armBlockedSessionGuard(ctx, classification.boundary, policy.detail);
      }
      return {
        block: true,
        blockReason: policy.detail,
      };
    }

    if (classification.normalizedParams) {
      return {
        params: classification.normalizedParams,
      };
    }
  };
}

async function executeClawCollectAction(
  api: OpenClawPluginApi,
  pluginConfig: ClawCollectPluginConfig,
  ctx: ClawCollectToolContext,
  rawParams: ClawCollectGenericParams,
) {
  const normalized = normalizeAction(readString(rawParams.action) ?? "status");
  const action = normalized.action;
  const execution = resolveExecutionContext(api, pluginConfig, ctx);
  const boundary = readBoundary(rawParams.boundary);
  const risk = readRisk(rawParams.risk);
  const approved = readBoolean(rawParams.approved);
  const operation = normalized.operation ?? readOrganizeOperation(rawParams.operation);
  const view = normalized.view ?? readQueryView(rawParams.view);

  switch (action) {
    case "status":
      return renderClawCollectStatus(execution.stateDir, pluginConfig, execution.scopeKey);

    case "capture": {
      const scopeResult = requireScope(execution.scopeKey, action);
      if (!scopeResult.ok) {
        return scopeResult.reply;
      }
      const content =
        readString(rawParams.content) ??
        readString(rawParams.title);
      if (!content) {
        return toolReply('Parameter "content" is required for capture.', {
          ok: false,
          action,
        });
      }
      const policyReply = authorizeMutation(pluginConfig, action, {
        subject: content,
        boundary,
        risk,
        approved,
        scopeKey: scopeResult.scopeKey,
      });
      if (policyReply.blockedReply) {
        return policyReply.blockedReply;
      }
      const result = await captureFragmentForScope(
        execution.stateDir,
        pluginConfig,
        scopeResult.scopeKey,
        execution.senderId ?? "unknown",
        content,
        undefined,
        {
          storeWithoutCollection: true,
        },
      );
      return toolReply(result.message, {
        ok: result.ok,
        code: result.code,
        action,
        scopeKey: scopeResult.scopeKey,
        policyWarning: policyReply.warning,
        ...result.data,
      });
    }

    case "organize": {
      if (!operation) {
        return toolReply('Parameter "operation" is required for organize.', {
          ok: false,
          action,
        });
      }

      if (operation === "open_collection") {
        const title = readString(rawParams.title);
        if (!title) {
          return toolReply('Parameter "title" is required for organize/open_collection.', {
            ok: false,
            action,
          });
        }
        const scopeResult = requireScope(execution.scopeKey, operation);
        if (!scopeResult.ok) {
          return scopeResult.reply;
        }
        const policyReply = authorizeMutation(pluginConfig, action, {
          subject: title,
          boundary,
          risk,
          approved,
          scopeKey: scopeResult.scopeKey,
        });
        if (policyReply.blockedReply) {
          return policyReply.blockedReply;
        }
        const result = await openCollectionForScope(
          execution.stateDir,
          pluginConfig,
          scopeResult.scopeKey,
          title,
          {
            boundary,
            risk,
            approved,
          },
        );
        return toolReply(result.message, {
          ok: result.ok,
          code: result.code,
          action,
          operation,
          scopeKey: scopeResult.scopeKey,
          policyWarning: policyReply.warning,
          ...result.data,
        });
      }

      if (operation === "close_collection") {
        const scopeResult = requireScope(execution.scopeKey, operation);
        if (!scopeResult.ok) {
          return scopeResult.reply;
        }
        const result = await closeCollectionForScope(
          execution.stateDir,
          pluginConfig,
          scopeResult.scopeKey,
        );
        return toolReply(result.message, {
          ok: result.ok,
          code: result.code,
          action,
          operation,
          scopeKey: scopeResult.scopeKey,
          ...result.data,
        });
      }

      return toolReply(`Unknown organize operation: ${operation}`, {
        ok: false,
        action,
        operation,
      });
    }

    case "query": {
      const resolvedView = view ?? "status";
      if (resolvedView === "status") {
        return renderClawCollectStatus(execution.stateDir, pluginConfig, execution.scopeKey);
      }
      if (resolvedView === "collection_status") {
        const scopeResult = requireScope(execution.scopeKey, action);
        if (!scopeResult.ok) {
          return scopeResult.reply;
        }
        const result = await getCollectionStatusForScope(
          execution.stateDir,
          pluginConfig,
          scopeResult.scopeKey,
        );
        return toolReply(result.message, {
          ok: result.ok,
          code: result.code,
          action,
          view: resolvedView,
          scopeKey: scopeResult.scopeKey,
          ...result.data,
        });
      }
      if (resolvedView === "collection_summary") {
        const scopeResult = requireScope(execution.scopeKey, action);
        if (!scopeResult.ok) {
          return scopeResult.reply;
        }
        const result = await getCollectionSummaryForScope(
          execution.stateDir,
          pluginConfig,
          scopeResult.scopeKey,
        );
        return toolReply(result.message, {
          ok: result.ok,
          code: result.code,
          action,
          view: resolvedView,
          scopeKey: scopeResult.scopeKey,
          ...result.data,
        });
      }
      if (resolvedView === "collection_inbox") {
        const scopeResult = requireScope(execution.scopeKey, action);
        if (!scopeResult.ok) {
          return scopeResult.reply;
        }
        const result = await getCollectionInboxForScope(
          execution.stateDir,
          pluginConfig,
          scopeResult.scopeKey,
          readPositiveLimit(rawParams.limit),
          execution.timeZone,
        );
        return toolReply(result.message, {
          ok: result.ok,
          code: result.code,
          action,
          view: resolvedView,
          scopeKey: scopeResult.scopeKey,
          captures: result.data?.captures ?? [],
        });
      }
      return toolReply(`Unknown query view: ${resolvedView}`, {
        ok: false,
        action,
        view: resolvedView,
      });
    }
  }
}

function createCaptureTool(
  api: OpenClawPluginApi,
  pluginConfig: ClawCollectPluginConfig,
  ctx: ClawCollectToolContext,
): AnyAgentTool {
  return {
    name: "clawcollect_capture",
    label: "ClawCollect Capture",
    description: "Capture freeform fragments into the current scope inbox.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        content: { type: "string", description: "Freeform content to capture." },
        boundary: {
          type: "string",
          enum: ["informational", "reminder_only", "organizational", "sensitive", "transactional"],
        },
        risk: {
          type: "string",
          enum: ["low", "medium", "high"],
        },
        approved: { type: "boolean" },
      },
      required: ["content", "boundary"],
    },
    execute: async (_toolCallId, rawParams) =>
      executeClawCollectAction(api, pluginConfig, ctx, {
        ...(rawParams as Record<string, unknown>),
        action: "capture",
      }),
  };
}

function createOrganizeTool(
  api: OpenClawPluginApi,
  pluginConfig: ClawCollectPluginConfig,
  ctx: ClawCollectToolContext,
): AnyAgentTool {
  return {
    name: "clawcollect_organize",
    label: "ClawCollect Organize",
    description: "Open or close chat collections in the current scope.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        operation: {
          type: "string",
          enum: ["open_collection", "close_collection"],
        },
        title: { type: "string" },
        boundary: {
          type: "string",
          enum: ["informational", "reminder_only", "organizational", "sensitive", "transactional"],
        },
        risk: {
          type: "string",
          enum: ["low", "medium", "high"],
        },
        approved: { type: "boolean" },
      },
      required: ["operation", "boundary"],
    },
    execute: async (_toolCallId, rawParams) =>
      executeClawCollectAction(api, pluginConfig, ctx, {
        ...(rawParams as Record<string, unknown>),
        action: "organize",
      }),
  };
}

function createQueryTool(
  api: OpenClawPluginApi,
  pluginConfig: ClawCollectPluginConfig,
  ctx: ClawCollectToolContext,
): AnyAgentTool {
  return {
    name: "clawcollect_query",
    label: "ClawCollect Query",
    description: "Inspect collection status, summary, or inbox.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        view: {
          type: "string",
          enum: ["status", "collection_status", "collection_summary", "collection_inbox"],
        },
        limit: { type: "number", minimum: 1, maximum: 50 },
      },
    },
    execute: async (_toolCallId, rawParams) =>
      executeClawCollectAction(api, pluginConfig, ctx, {
        ...(rawParams as Record<string, unknown>),
        action: "query",
      }),
  };
}

export function createClawCollectToolFactory(
  api: OpenClawPluginApi,
  pluginConfig: ClawCollectPluginConfig,
) {
  return (ctx: ClawCollectToolContext): AnyAgentTool[] => [
    createCaptureTool(api, pluginConfig, ctx),
    createOrganizeTool(api, pluginConfig, ctx),
    createQueryTool(api, pluginConfig, ctx),
  ];
}
