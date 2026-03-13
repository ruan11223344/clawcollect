import type { AgentMessage } from "@mariozechner/pi-agent-core";

import { parseScopeKey, resolveToolScope, scopeToMessageTarget } from "./scope";
import type { ClawCollectBoundaryKind } from "./types";

type GuardHookUsage = {
  beforeMessageWrite?: boolean;
  messageSending?: boolean;
};

type BlockedSessionGuard = {
  sessionKey?: string;
  scopeKey?: string;
  channel?: string;
  accountId?: string;
  conversationId?: string;
  target?: string;
  boundary: ClawCollectBoundaryKind;
  reason: string;
  refusalText: string;
  expiresAt: number;
  outputRewrittenAt?: number;
  usedBy: GuardHookUsage;
};

type ToolScopeContext = {
  sessionKey?: string;
  messageChannel?: string;
  agentAccountId?: string;
  requesterSenderId?: string;
};

type MessageSendContext = {
  channelId: string;
  accountId?: string;
  conversationId?: string;
};

type MessageSendEvent = {
  to: string;
};

const BLOCKED_SESSION_TTL_MS = 2 * 60 * 1000;
const POST_REWRITE_GRACE_MS = 15 * 1000;

const blockedSessionGuards = new Map<string, BlockedSessionGuard>();

function stripPeerPrefix(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.replace(/^(user:|dm:|open_id:|group:|channel:|chat:)/, "");
}

function buildConversationKey(
  channel: string | undefined,
  accountId: string | undefined,
  conversationId: string | undefined,
): string | null {
  const resolvedChannel = channel?.trim();
  const resolvedAccountId = accountId?.trim() || "default";
  const resolvedConversationId = stripPeerPrefix(conversationId);
  if (!resolvedChannel || !resolvedConversationId) {
    return null;
  }
  return `${resolvedChannel}:${resolvedAccountId}:${resolvedConversationId}`;
}

function buildRefusalText(boundary: ClawCollectBoundaryKind, reason: string): string {
  if (boundary === "sensitive") {
    return [
      "这类敏感信息不能继续在当前共享聊天里处理。",
      "我不会在这里继续收集、整理、复述、转发，或调用其他工具发送这类内容。",
      `原因：${reason}`,
      "如果你要继续，请切到受保护的私聊，再明确授权后处理。",
    ].join("\n");
  }

  if (boundary === "transactional") {
    return [
      "这类交易或高风险执行不会由当前插件直接继续处理。",
      "我不会继续付款、下单、转发交易数据，或调用其他工具执行这类内容。",
      `原因：${reason}`,
      "如果需要，我可以改为提醒、清单或人工确认流程。",
    ].join("\n");
  }

  return [
    "这个请求触发了当前策略限制。",
    `原因：${reason}`,
  ].join("\n");
}

function purgeExpiredGuards(): void {
  const now = Date.now();
  for (const [key, guard] of blockedSessionGuards.entries()) {
    const rewrittenExpired =
      guard.outputRewrittenAt !== undefined &&
      now - guard.outputRewrittenAt > POST_REWRITE_GRACE_MS;
    if (guard.expiresAt <= now || rewrittenExpired) {
      blockedSessionGuards.delete(key);
    }
  }
}

function resolveConversationKeyFromScope(scopeKey?: string): string | null {
  const scope = parseScopeKey(scopeKey);
  if (!scope) {
    return null;
  }
  return buildConversationKey(scope.channel, scope.accountId, scope.peerId);
}

function matchGuardForSending(
  guard: BlockedSessionGuard,
  ctx: MessageSendContext,
  event: MessageSendEvent,
): boolean {
  const conversationKey = buildConversationKey(
    ctx.channelId,
    ctx.accountId,
    ctx.conversationId ?? event.to,
  );
  if (conversationKey && guard.scopeKey) {
    const guardConversationKey = resolveConversationKeyFromScope(guard.scopeKey);
    if (guardConversationKey && conversationKey === guardConversationKey) {
      return true;
    }
  }

  const normalizedTarget = stripPeerPrefix(event.to);
  if (normalizedTarget && guard.target) {
    return stripPeerPrefix(guard.target) === normalizedTarget;
  }

  return false;
}

export function armBlockedSessionGuard(
  ctx: ToolScopeContext,
  boundary: ClawCollectBoundaryKind,
  reason: string,
): void {
  purgeExpiredGuards();

  const scope = resolveToolScope(ctx);
  const refusalText = buildRefusalText(boundary, reason);
  const guard: BlockedSessionGuard = {
    sessionKey: ctx.sessionKey?.trim() || undefined,
    scopeKey: scope?.scopeKey,
    channel: scope?.channel,
    accountId: scope?.accountId,
    conversationId: scope ? stripPeerPrefix(scope.peerId) : undefined,
    target: scope ? scopeToMessageTarget(scope) : undefined,
    boundary,
    reason,
    refusalText,
    expiresAt: Date.now() + BLOCKED_SESSION_TTL_MS,
    usedBy: {},
  };

  const key = guard.sessionKey || guard.scopeKey;
  if (!key) {
    return;
  }
  blockedSessionGuards.set(key, guard);
}

export function shouldBlockFollowupTools(sessionKey?: string): string | undefined {
  purgeExpiredGuards();
  const key = sessionKey?.trim();
  if (!key) {
    return undefined;
  }
  const guard = blockedSessionGuards.get(key);
  if (!guard || guard.outputRewrittenAt) {
    return undefined;
  }
  return guard.refusalText;
}

export function rewriteBlockedAssistantMessage(
  sessionKey: string | undefined,
  message: AgentMessage,
): AgentMessage {
  purgeExpiredGuards();
  const key = sessionKey?.trim();
  if (!key) {
    return message;
  }

  const guard = blockedSessionGuards.get(key);
  if (!guard) {
    return message;
  }

  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return message;
  }

  const record = message as { role?: unknown; content?: unknown };
  if (record.role !== "assistant") {
    return message;
  }

  guard.outputRewrittenAt = Date.now();
  guard.usedBy.beforeMessageWrite = true;

  return {
    ...((message as unknown) as Record<string, unknown>),
    content: [{ type: "text", text: guard.refusalText }],
  } as AgentMessage;
}

export function rewriteBlockedOutgoingMessage(
  ctx: MessageSendContext,
  event: MessageSendEvent,
): string | undefined {
  purgeExpiredGuards();

  for (const [key, guard] of blockedSessionGuards.entries()) {
    if (!matchGuardForSending(guard, ctx, event)) {
      continue;
    }

    guard.usedBy.messageSending = true;
    const rewritten = guard.refusalText;

    if (guard.usedBy.beforeMessageWrite || guard.usedBy.messageSending) {
      blockedSessionGuards.delete(key);
    }

    return rewritten;
  }

  return undefined;
}
