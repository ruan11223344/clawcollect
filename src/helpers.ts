import { randomUUID } from "node:crypto";

import type {
  AssetKind,
  AssetRef,
  Checklist,
  ChecklistItem,
  ChecklistItemStatus,
  LifeCommandContext,
  LifeMessageContext,
  Reminder,
} from "./types";
import {
  createChecklistPayload,
  createReminderPayload,
  renderPayloadText,
} from "./presentation";
import { formatClawCollectDateTime, parseClawCollectDateTime } from "./timezone";

export function nowIso(): string {
  return new Date().toISOString();
}

export function makeId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

export function textReply(text: string): { text: string } {
  return { text };
}

export function splitFirstWord(input: string): { head: string; tail: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { head: "", tail: "" };
  }
  const firstSpace = trimmed.search(/\s/);
  if (firstSpace === -1) {
    return { head: trimmed, tail: "" };
  }
  return {
    head: trimmed.slice(0, firstSpace),
    tail: trimmed.slice(firstSpace).trim(),
  };
}

export function splitPipeArgs(input: string): string[] {
  return input
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function normalizeItemText(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[()（）[\]{}]/g, " ")
    .replace(/[，,、;/+]/g, " ")
    .replace(/\s+/g, " ");
}

export function resolveCommandConversationKey(ctx: LifeCommandContext): string {
  const channel = (ctx.channelId ?? ctx.channel).trim();
  const accountId = (ctx.accountId ?? "default").trim();
  const conversationId = (ctx.to ?? ctx.from ?? ctx.senderId ?? "direct").trim();
  return `${channel}:${accountId}:${conversationId}`;
}

export function resolveMessageConversationKey(ctx: LifeMessageContext): string | null {
  const channel = (ctx.channelId ?? "").trim();
  const conversationId = (ctx.conversationId ?? "").trim();
  if (!channel || !conversationId) {
    return null;
  }
  const accountId = (ctx.accountId ?? "default").trim();
  return `${channel}:${accountId}:${conversationId}`;
}

export function parseDueAt(raw: string, timeZone?: string): string | null {
  return parseClawCollectDateTime(raw, timeZone);
}

export function findByIdPrefix<T extends { id: string }>(items: T[], rawId: string): T | null {
  const needle = rawId.trim();
  if (!needle) {
    return null;
  }
  const exact = items.find((item) => item.id === needle);
  if (exact) {
    return exact;
  }
  const matched = items.filter((item) => item.id.startsWith(needle));
  return matched.length === 1 ? matched[0] : null;
}

export function formatTimestamp(iso: string, timeZone?: string): string {
  return formatClawCollectDateTime(iso, timeZone);
}

export function summarizeChecklist(list: Checklist): string {
  const openCount = list.items.filter((item) => item.status === "open").length;
  const doneCount = list.items.filter((item) => item.status === "done").length;
  const kind = list.kind?.trim() ? ` | kind ${list.kind}` : "";
  return `${list.id} | ${list.title}${kind} | open ${openCount} | done ${doneCount}`;
}

export function renderChecklist(list: Checklist, timeZone?: string): string {
  return renderPayloadText(createChecklistPayload(list, timeZone));
}

export function renderChecklistItem(item: ChecklistItem): string {
  const requestedBy = item.requestedBy.length > 0 ? ` <- ${item.requestedBy.join(", ")}` : "";
  const marker = item.status === "done" ? "[x]" : "[ ]";
  return `${marker} ${item.id} ${item.text}${requestedBy}`;
}

export function renderReminder(
  reminder: Reminder,
  relatedList?: Checklist,
  timeZone?: string,
): string {
  return renderPayloadText(createReminderPayload(reminder, relatedList, timeZone));
}

export function countChecklistItems(
  list: Checklist,
  status: ChecklistItemStatus,
): number {
  return list.items.filter((item) => item.status === status).length;
}

export function extractChecklistItems(rawText: string): string[] {
  const text = rawText.trim();
  if (!text || text.startsWith("/")) {
    return [];
  }

  // Keep extraction language-agnostic. We only auto-structure messages that
  // already look like an explicit list via delimiters or multiple lines.
  const hasExplicitListShape =
    /[,\n，、;/+]/u.test(text) || text.split(/\n/).filter(Boolean).length > 1;
  if (!hasExplicitListShape) {
    return [];
  }

  const pieces = text
    .split(/[,\n，、;/+]/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/^[>\-\*\d.)\s]+/, "").trim())
    .filter((part) => part.length > 1)
    .filter((part) => !/^(thanks|ok|好的|谢谢|收到)$/iu.test(part))
    .filter((part) => !/^https?:\/\/\S+$/i.test(part));

  const seen = new Set<string>();
  const results: string[] = [];
  for (const piece of pieces) {
    const normalized = normalizeItemText(piece);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    results.push(piece);
  }

  if (results.length > 0) {
    return results;
  }
  return [];
}

function inferAssetKind(rawKind: string, mimeType: string): AssetKind {
  const kind = rawKind.trim().toLowerCase();
  const mime = mimeType.trim().toLowerCase();
  if (kind === "image" || mime.startsWith("image/")) {
    return "image";
  }
  if (kind === "audio" || mime.startsWith("audio/")) {
    return "audio";
  }
  if (kind === "video" || mime.startsWith("video/")) {
    return "video";
  }
  if (kind === "file" || kind === "document" || mime) {
    return "file";
  }
  return "unknown";
}

export function extractAssetRefs(
  rawText: string,
  metadata?: Record<string, unknown>,
): AssetRef[] {
  const assets: AssetRef[] = [];
  const seen = new Set<string>();

  const pushAsset = (asset: Omit<AssetRef, "id">): void => {
    const fingerprint = [
      asset.kind,
      asset.name ?? "",
      asset.mimeType ?? "",
      asset.url ?? "",
      asset.localPath ?? "",
    ].join("|");
    if (seen.has(fingerprint)) {
      return;
    }
    seen.add(fingerprint);
    assets.push({
      id: makeId("asset"),
      ...asset,
    });
  };

  const attachments = metadata?.attachments;
  if (Array.isArray(attachments)) {
    for (const entry of attachments) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }
      const record = entry as Record<string, unknown>;
      const rawKind = typeof record.kind === "string" ? record.kind : typeof record.type === "string" ? record.type : "";
      const mimeType = typeof record.mimeType === "string" ? record.mimeType : typeof record.mimetype === "string" ? record.mimetype : "";
      const name =
        typeof record.name === "string"
          ? record.name
          : typeof record.fileName === "string"
            ? record.fileName
            : typeof record.filename === "string"
              ? record.filename
              : undefined;
      const url =
        typeof record.url === "string"
          ? record.url
          : typeof record.mediaUrl === "string"
            ? record.mediaUrl
            : typeof record.downloadUrl === "string"
              ? record.downloadUrl
              : undefined;
      const localPath =
        typeof record.localPath === "string"
          ? record.localPath
          : typeof record.filePath === "string"
            ? record.filePath
            : typeof record.path === "string"
              ? record.path
              : undefined;

      pushAsset({
        kind: inferAssetKind(rawKind, mimeType),
        name,
        mimeType,
        url,
        localPath,
      });
    }
  }

  const directMediaUrl = metadata?.mediaUrl;
  if (typeof directMediaUrl === "string" && directMediaUrl.trim()) {
    pushAsset({
      kind: "file",
      url: directMediaUrl.trim(),
    });
  }

  const urlMatches = rawText.match(/https?:\/\/\S+/g) ?? [];
  for (const match of urlMatches) {
    pushAsset({
      kind: "url",
      url: match,
    });
  }

  return assets;
}
