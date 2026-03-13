import { makeId, normalizeItemText, nowIso } from "./helpers.js";
import type {
  AssetRef,
  Checklist,
  ChecklistItem,
  CaptureRecord,
  CollectionSession,
  ClawCollectBoundaryKind,
  ClawCollectRiskLevel,
  ClawCollectStore,
  Reminder,
} from "./types.js";

export function createDefaultStore(): ClawCollectStore {
  return {
    version: 4,
    lists: [],
    reminders: [],
    collectionSessions: [],
    captures: [],
    onlineCollections: [],
    dispatches: {
      sent: {},
    },
  };
}

export function createChecklist(title: string, kind?: string): Checklist {
  const timestamp = nowIso();
  return {
    id: makeId("list"),
    title: title.trim(),
    kind: kind?.trim() || undefined,
    items: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createReminder(
  title: string,
  dueAt: string,
  relatedListId?: string,
  note?: string,
  timezone?: string,
  originScopeKey?: string,
): Reminder {
  const timestamp = nowIso();
  return {
    id: makeId("rem"),
    title: title.trim(),
    dueAt,
    timezone: timezone?.trim() || undefined,
    originScopeKey: originScopeKey?.trim() || undefined,
    status: "pending",
    relatedListId,
    note,
    delivery: {
      attemptCount: 0,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createCollectionSession(
  scopeKey: string,
  title: string,
  listId: string,
  boundary?: ClawCollectBoundaryKind,
  risk?: ClawCollectRiskLevel,
  approved?: boolean,
): CollectionSession {
  const timestamp = nowIso();
  return {
    id: makeId("col"),
    title: title.trim(),
    listId,
    scopeKey,
    status: "open",
    boundary,
    risk,
    approved,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function appendManualItem(list: Checklist, text: string): ChecklistItem {
  const timestamp = nowIso();
  const item: ChecklistItem = {
    id: makeId("item"),
    text: text.trim(),
    normalizedText: normalizeItemText(text),
    status: "open",
    requestedBy: [],
    createdFrom: "manual",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  list.items.push(item);
  list.updatedAt = timestamp;
  return item;
}

export function mergeCapturedItems(
  list: Checklist,
  items: string[],
  requester: string,
): { added: number; merged: number } {
  let added = 0;
  let merged = 0;
  const timestamp = nowIso();

  for (const rawItem of items) {
    const text = rawItem.trim();
    if (!text) {
      continue;
    }
    const normalizedText = normalizeItemText(text);
    const existing = list.items.find((item) => item.normalizedText === normalizedText);

    if (existing) {
      if (!existing.requestedBy.includes(requester)) {
        existing.requestedBy.push(requester);
      }
      existing.updatedAt = timestamp;
      merged += 1;
      continue;
    }

    list.items.push({
      id: makeId("item"),
      text,
      normalizedText,
      status: "open",
      requestedBy: requester ? [requester] : [],
      createdFrom: "capture",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    added += 1;
  }

  list.updatedAt = timestamp;
  return { added, merged };
}

export function createCaptureRecord(
  scopeKey: string,
  from: string,
  content: string,
  extractedItems: string[],
  assets: AssetRef[],
): CaptureRecord {
  return {
    id: makeId("cap"),
    scopeKey,
    from,
    content,
    extractedItems,
    assets,
    capturedAt: nowIso(),
  };
}
