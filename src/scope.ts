import type { LifeCommandContext, LifeMessageContext, LifeMessageEvent } from "./types";

export type LifeScopeChatKind = "direct" | "group" | "channel";

export type LifeScope = {
  scopeKey: string;
  channel: string;
  accountId: string;
  chatKind: LifeScopeChatKind;
  peerId: string;
};

type LifeToolContext = {
  sessionKey?: string;
  messageChannel?: string;
  agentAccountId?: string;
  requesterSenderId?: string;
};

const DIRECT_CHAT_KINDS = new Set(["direct", "dm", "p2p", "private", "user"]);
const GROUP_CHAT_KINDS = new Set(["group", "chat"]);
const CHANNEL_CHAT_KINDS = new Set(["channel"]);

function readStringMetadata(
  metadata: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined {
  if (!metadata) {
    return undefined;
  }

  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function readBooleanMetadata(
  metadata: Record<string, unknown> | undefined,
  keys: string[],
): boolean | undefined {
  if (!metadata) {
    return undefined;
  }

  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "boolean") {
      return value;
    }
  }

  return undefined;
}

function normalizeDirectPeerId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (
    trimmed.startsWith("user:") ||
    trimmed.startsWith("dm:") ||
    trimmed.startsWith("open_id:")
  ) {
    return trimmed;
  }
  return `user:${trimmed}`;
}

function normalizeScopedPeerId(kind: LifeScopeChatKind, raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (kind === "direct") {
    return normalizeDirectPeerId(trimmed);
  }
  if (trimmed.startsWith(`${kind}:`)) {
    return trimmed.slice(kind.length + 1).trim() || trimmed;
  }
  if (trimmed.startsWith("chat:")) {
    return trimmed.slice("chat:".length).trim() || trimmed;
  }
  if (trimmed.startsWith("group:")) {
    return trimmed.slice("group:".length).trim() || trimmed;
  }
  if (trimmed.startsWith("channel:")) {
    return trimmed.slice("channel:".length).trim() || trimmed;
  }
  return trimmed;
}

function buildScope(
  channel: string,
  accountId: string,
  chatKind: LifeScopeChatKind,
  peerId: string,
): LifeScope {
  const normalizedPeerId = normalizeScopedPeerId(chatKind, peerId);
  return {
    channel,
    accountId,
    chatKind,
    peerId: normalizedPeerId,
    scopeKey: `${channel}:${accountId}:${chatKind}:${normalizedPeerId}`,
  };
}

function resolveMetadataChatKind(
  metadata?: Record<string, unknown>,
): LifeScopeChatKind | undefined {
  const rawKind = readStringMetadata(metadata, [
    "chatType",
    "chat_type",
    "conversationType",
    "conversation_type",
    "peerKind",
    "peer_kind",
  ]);

  if (rawKind) {
    const normalized = rawKind.trim().toLowerCase();
    if (DIRECT_CHAT_KINDS.has(normalized)) {
      return "direct";
    }
    if (GROUP_CHAT_KINDS.has(normalized)) {
      return "group";
    }
    if (CHANNEL_CHAT_KINDS.has(normalized)) {
      return "channel";
    }
  }

  if (readBooleanMetadata(metadata, ["isGroup", "group", "is_group"]) === true) {
    return "group";
  }

  return undefined;
}

function resolveScopedPeerFromTarget(rawTarget: string): {
  chatKind: LifeScopeChatKind;
  peerId: string;
} | null {
  const trimmed = rawTarget.trim();
  if (!trimmed) {
    return null;
  }

  const lowered = trimmed.toLowerCase();
  if (lowered.startsWith("group:") || lowered.startsWith("chat:")) {
    return {
      chatKind: "group",
      peerId: normalizeScopedPeerId("group", trimmed),
    };
  }

  if (lowered.startsWith("channel:")) {
    return {
      chatKind: "channel",
      peerId: normalizeScopedPeerId("channel", trimmed),
    };
  }

  if (
    lowered.startsWith("user:") ||
    lowered.startsWith("dm:") ||
    lowered.startsWith("open_id:")
  ) {
    return {
      chatKind: "direct",
      peerId: normalizeDirectPeerId(trimmed),
    };
  }

  return null;
}

function parseSessionKeyScope(sessionKey?: string): {
  channel: string;
  accountId?: string;
  chatKind: LifeScopeChatKind;
  peerId: string;
} | null {
  const raw = sessionKey?.trim();
  if (!raw) {
    return null;
  }

  const groupMatch = raw.match(/^agent:[^:]+:([^:]+):group:([^:]+)(?::topic:.*)?$/);
  if (groupMatch) {
    return {
      channel: groupMatch[1],
      chatKind: "group",
      peerId: groupMatch[2],
    };
  }

  const channelMatch = raw.match(/^agent:[^:]+:([^:]+):channel:([^:]+)$/);
  if (channelMatch) {
    return {
      channel: channelMatch[1],
      chatKind: "channel",
      peerId: channelMatch[2],
    };
  }

  const dmMatch = raw.match(/^agent:[^:]+:([^:]+)(?::([^:]+))?:dm:(.+)$/);
  if (dmMatch) {
    return {
      channel: dmMatch[1],
      accountId: dmMatch[2],
      chatKind: "direct",
      peerId: dmMatch[3],
    };
  }

  return null;
}

export function resolveCommandScope(ctx: LifeCommandContext): LifeScope | null {
  const channel = (ctx.channelId ?? ctx.channel).trim();
  if (!channel) {
    return null;
  }

  const accountId = (ctx.accountId ?? "default").trim();
  const explicitTarget = resolveScopedPeerFromTarget(ctx.to ?? "");
  if (explicitTarget) {
    return buildScope(channel, accountId, explicitTarget.chatKind, explicitTarget.peerId);
  }

  const senderId = (ctx.senderId ?? ctx.from ?? "").trim();
  if (senderId) {
    return buildScope(channel, accountId, "direct", senderId);
  }

  const fallbackTarget = (ctx.to ?? "").trim();
  if (fallbackTarget) {
    return buildScope(channel, accountId, "direct", fallbackTarget);
  }

  return null;
}

export function resolveMessageScope(
  ctx: LifeMessageContext,
  event: Pick<LifeMessageEvent, "from" | "metadata">,
): LifeScope | null {
  const channel = (ctx.channelId ?? "").trim();
  if (!channel) {
    return null;
  }

  const accountId = (ctx.accountId ?? "default").trim();
  const chatKind = resolveMetadataChatKind(event.metadata);

  if (chatKind === "group" || chatKind === "channel") {
    const peerId =
      ctx.conversationId?.trim() ??
      readStringMetadata(event.metadata, ["chatId", "chat_id", "groupId", "group_id"]);
    if (peerId) {
      return buildScope(channel, accountId, chatKind, peerId);
    }
  }

  const senderId =
    event.from.trim() || readStringMetadata(event.metadata, ["senderId", "sender_id"]);
  if (senderId) {
    return buildScope(channel, accountId, "direct", senderId);
  }

  const conversationId = ctx.conversationId?.trim();
  if (conversationId) {
    return buildScope(channel, accountId, "direct", conversationId);
  }

  return null;
}

export function resolveToolScope(ctx: LifeToolContext): LifeScope | null {
  const parsedSession = parseSessionKeyScope(ctx.sessionKey);
  if (parsedSession) {
    return buildScope(
      parsedSession.channel,
      parsedSession.accountId?.trim() || ctx.agentAccountId?.trim() || "default",
      parsedSession.chatKind,
      parsedSession.peerId,
    );
  }

  const channel = ctx.messageChannel?.trim();
  if (!channel) {
    return null;
  }

  const requester = ctx.requesterSenderId?.trim();
  if (requester) {
    return buildScope(channel, ctx.agentAccountId?.trim() || "default", "direct", requester);
  }

  return null;
}

export function parseScopeKey(scopeKey?: string): LifeScope | null {
  const raw = scopeKey?.trim();
  if (!raw) {
    return null;
  }

  const match = raw.match(/^([^:]+):([^:]+):(direct|group|channel):(.+)$/);
  if (!match) {
    return null;
  }

  const [, channel, accountId, chatKind, peerId] = match;
  return buildScope(channel, accountId, chatKind as LifeScopeChatKind, peerId);
}

export function scopeToMessageTarget(scope: LifeScope): string {
  if (scope.chatKind === "direct") {
    return scope.peerId;
  }

  if (scope.chatKind === "channel") {
    return `channel:${scope.peerId}`;
  }

  return `group:${scope.peerId}`;
}
