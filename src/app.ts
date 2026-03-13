import {
  appendManualItem,
  createCaptureRecord,
  createChecklist,
  createCollectionSession,
  createReminder,
  mergeCapturedItems,
} from "./domain.js";
import {
  extractAssetRefs,
  extractChecklistItems,
  findByIdPrefix,
  formatTimestamp,
  parseDueAt,
  renderChecklist,
  renderReminder,
  summarizeChecklist,
} from "./helpers.js";
import { evaluateClawCollectPolicy } from "./policy.js";
import { loadStore, updateStore } from "./storage.js";
import type {
  Checklist,
  CollectionSession,
  ClawCollectPluginConfig,
  ClawCollectBoundaryKind,
  ClawCollectRiskLevel,
  ClawCollectStore,
  Reminder,
} from "./types.js";

export type ClawCollectActionResult<T = Record<string, unknown>> = {
  ok: boolean;
  code: string;
  message: string;
  data?: T;
};

export function findActiveCollection(
  scopeKey: string,
  store: ClawCollectStore,
): CollectionSession | undefined {
  return store.collectionSessions.find(
    (session) => session.status === "open" && session.scopeKey === scopeKey,
  );
}

function countScopedCaptures(scopeKey: string, store: ClawCollectStore): {
  rawOnlyCount: number;
  structuredCount: number;
} {
  let rawOnlyCount = 0;
  let structuredCount = 0;

  for (const capture of store.captures) {
    if (capture.scopeKey !== scopeKey) {
      continue;
    }
    if (capture.extractedItems.length > 0) {
      structuredCount += 1;
    } else {
      rawOnlyCount += 1;
    }
  }

  return { rawOnlyCount, structuredCount };
}

function findListForSession(
  session: CollectionSession | undefined,
  store: ClawCollectStore,
): Checklist | undefined {
  if (!session) {
    return undefined;
  }
  return store.lists.find((entry) => entry.id === session.listId);
}

export async function openCollectionForScope(
  stateDir: string,
  pluginConfig: ClawCollectPluginConfig,
  scopeKey: string,
  title: string,
  options?: {
    boundary?: ClawCollectBoundaryKind;
    risk?: ClawCollectRiskLevel;
    approved?: boolean;
  },
): Promise<
  ClawCollectActionResult<{
    status: "opened" | "existing";
    session: CollectionSession;
    list?: Checklist;
  }>
> {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    return {
      ok: false,
      code: "invalid_title",
      message: "Collection title is required.",
    };
  }

  const result = await updateStore(stateDir, pluginConfig, (store) => {
    const existing = findActiveCollection(scopeKey, store);
    if (existing) {
      return {
        status: "existing" as const,
        session: existing,
        list: findListForSession(existing, store),
      };
    }

    const list = createChecklist(trimmedTitle);
    const session = createCollectionSession(
      scopeKey,
      trimmedTitle,
      list.id,
      options?.boundary,
      options?.risk,
      options?.approved,
    );
    store.lists.push(list);
    store.collectionSessions.push(session);
    return {
      status: "opened" as const,
      session,
      list,
    };
  });

  if (result.status === "existing") {
    return {
      ok: true,
      code: "existing_collection",
      message: `Collection already open here: ${result.list?.title ?? result.session.title} (${result.session.listId})`,
      data: result,
    };
  }

  return {
    ok: true,
    code: "collection_opened",
    message: `Collection opened: ${result.list.title} (${result.list.id}). Normal chat messages in this scope can now be captured and summarized.`,
    data: result,
  };
}

export async function getCollectionStatusForScope(
  stateDir: string,
  pluginConfig: ClawCollectPluginConfig,
  scopeKey: string,
): Promise<
  ClawCollectActionResult<{
    session: CollectionSession;
    list?: Checklist;
    rawOnlyCount: number;
    structuredCount: number;
  }>
> {
  const store = await loadStore(stateDir, pluginConfig);
  const session = findActiveCollection(scopeKey, store);
  if (!session) {
    return {
      ok: false,
      code: "no_active_collection",
      message: "No active collection in this scope.",
    };
  }

  const list = findListForSession(session, store);
  const { rawOnlyCount, structuredCount } = countScopedCaptures(scopeKey, store);

  return {
    ok: true,
    code: "collection_status",
    message: [
      `Collection status: ${session.title} (${session.listId})`,
      `- raw fragments here: ${rawOnlyCount}`,
      `- structured captures here: ${structuredCount}`,
      `- list items: ${list?.items.length ?? 0}`,
    ].join("\n"),
    data: {
      session,
      list,
      rawOnlyCount,
      structuredCount,
    },
  };
}

export async function captureFragmentForScope(
  stateDir: string,
  pluginConfig: ClawCollectPluginConfig,
  scopeKey: string,
  from: string,
  content: string,
  metadata?: Record<string, unknown>,
  options?: {
    storeWithoutCollection?: boolean;
  },
): Promise<
  ClawCollectActionResult<{
    stored: boolean;
    blocked?: boolean;
    session?: CollectionSession;
    extractedItems: string[];
    assetsCount: number;
    added?: number;
    merged?: number;
  }>
> {
  const trimmedContent = content.trim();
  if (!trimmedContent) {
    return {
      ok: false,
      code: "invalid_content",
      message: "Capture content is required.",
    };
  }

  const extractedItems = extractChecklistItems(trimmedContent);
  const assets = extractAssetRefs(trimmedContent, metadata);
  const allowRawWithoutCollection =
    options?.storeWithoutCollection === true || pluginConfig.capture?.storeRawOutsideCollection === true;

  const result = await updateStore(stateDir, pluginConfig, (store) => {
    const activeSession = findActiveCollection(scopeKey, store);
    if (activeSession?.boundary) {
      const policy = evaluateClawCollectPolicy(pluginConfig, {
        subject: `collection:${activeSession.title}`,
        boundary: activeSession.boundary,
        risk: activeSession.risk,
        approved: activeSession.approved,
      });
      if (policy.status === "blocked") {
        return {
          stored: false as const,
          blocked: true as const,
          session: activeSession,
          extractedItems,
          assetsCount: assets.length,
        };
      }
    }

    const shouldStore =
      Boolean(activeSession) ||
      pluginConfig.capture?.onlyWhenCollectionOpen === false ||
      allowRawWithoutCollection;

    if (!shouldStore) {
      return {
        stored: false as const,
        session: activeSession,
        extractedItems,
        assetsCount: assets.length,
      };
    }

    store.captures.push(
      createCaptureRecord(scopeKey, from || "unknown", trimmedContent, extractedItems, assets),
    );

    if (!activeSession || extractedItems.length === 0) {
      return {
        stored: true as const,
        session: activeSession,
        extractedItems,
        assetsCount: assets.length,
      };
    }

    const list = store.lists.find((entry) => entry.id === activeSession.listId);
    if (!list) {
      return {
        stored: true as const,
        session: activeSession,
        extractedItems,
        assetsCount: assets.length,
      };
    }

    const merged = mergeCapturedItems(list, extractedItems, from || "unknown");
    activeSession.updatedAt = new Date().toISOString();

    return {
      stored: true as const,
      session: activeSession,
      extractedItems,
      assetsCount: assets.length,
      added: merged.added,
      merged: merged.merged,
    };
  });

  if (!result.stored) {
    return {
      ok: true,
      code: result.blocked ? "capture_blocked" : "capture_ignored",
      message: result.blocked
        ? "Active collection in this scope is blocked by policy."
        : "No active collection in this scope, and raw capture outside collections is disabled.",
      data: result,
    };
  }

  const parts = [
    extractedItems.length > 0
      ? `Captured fragment in ${scopeKey}`
      : `Captured raw fragment in ${scopeKey}`,
    extractedItems.length > 0
      ? `structured ${extractedItems.length}`
      : result.session
        ? "not structured into checklist; saved to inbox for later interpretation"
        : "saved to inbox only",
    assets.length > 0 ? `assets ${assets.length}` : undefined,
  ].filter(Boolean);

  return {
    ok: true,
    code: "fragment_captured",
    message: parts.join(" | "),
    data: result,
  };
}

export async function getCollectionSummaryForScope(
  stateDir: string,
  pluginConfig: ClawCollectPluginConfig,
  scopeKey: string,
): Promise<
  ClawCollectActionResult<{
    session: CollectionSession;
    list: Checklist;
    rawOnlyCount: number;
  }>
> {
  const store = await loadStore(stateDir, pluginConfig);
  const session = findActiveCollection(scopeKey, store);
  if (!session) {
    return {
      ok: false,
      code: "no_active_collection",
      message: "No active collection in this scope.",
    };
  }

  const list = findListForSession(session, store);
  if (!list) {
    return {
      ok: false,
      code: "missing_collection_list",
      message: `Collection list missing for session ${session.id}.`,
    };
  }

  const { rawOnlyCount } = countScopedCaptures(scopeKey, store);
  const suffix =
    rawOnlyCount > 0
      ? `\n\nRaw fragments waiting for later interpretation: ${rawOnlyCount}`
      : "";

  return {
    ok: true,
    code: "collection_summary",
    message: `${renderChecklist(list)}${suffix}`,
    data: {
      session,
      list,
      rawOnlyCount,
    },
  };
}

export async function getCollectionInboxForScope(
  stateDir: string,
  pluginConfig: ClawCollectPluginConfig,
  scopeKey: string,
  limit = 10,
  timeZone?: string,
): Promise<
  ClawCollectActionResult<{
    captures: ClawCollectStore["captures"];
  }>
> {
  const store = await loadStore(stateDir, pluginConfig);
  const captures = store.captures
    .filter((entry) => entry.scopeKey === scopeKey)
    .slice(-Math.max(1, Math.min(limit, 50)))
    .reverse();

  if (captures.length === 0) {
    return {
      ok: true,
      code: "empty_inbox",
      message: "No captured fragments in this scope yet.",
      data: { captures: [] },
    };
  }

  const rendered = captures
    .map((capture) => {
      const extracted =
        capture.extractedItems.length > 0
          ? ` -> ${capture.extractedItems.join(", ")}`
          : " -> raw";
      const assets = capture.assets.length > 0 ? ` | assets ${capture.assets.length}` : "";
      return `${formatTimestamp(capture.capturedAt, timeZone)} | ${capture.from}: ${capture.content}${extracted}${assets}`;
    })
    .join("\n");

  return {
    ok: true,
    code: "collection_inbox",
    message: rendered,
    data: { captures },
  };
}

export async function closeCollectionForScope(
  stateDir: string,
  pluginConfig: ClawCollectPluginConfig,
  scopeKey: string,
): Promise<
  ClawCollectActionResult<{
    session: CollectionSession;
    list?: Checklist;
  }>
> {
  const result = await updateStore(stateDir, pluginConfig, (store) => {
    const session = findActiveCollection(scopeKey, store);
    if (!session) {
      return { error: "No active collection in this scope." };
    }

    session.status = "closed";
    session.updatedAt = new Date().toISOString();
    return {
      session,
      list: findListForSession(session, store),
    };
  });

  if ("error" in result) {
    return {
      ok: false,
      code: "no_active_collection",
      message: result.error ?? "No active collection in this scope.",
    };
  }

  return {
    ok: true,
    code: "collection_closed",
    message: `Collection closed: ${result.list?.title ?? result.session.title} (${result.session.listId})`,
    data: result,
  };
}

export async function createListEntry(
  stateDir: string,
  pluginConfig: ClawCollectPluginConfig,
  title: string,
): Promise<
  ClawCollectActionResult<{
    list: Checklist;
  }>
> {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    return {
      ok: false,
      code: "invalid_title",
      message: "List title is required.",
    };
  }

  const list = await updateStore(stateDir, pluginConfig, (store) => {
    const nextList = createChecklist(trimmedTitle);
    store.lists.push(nextList);
    return nextList;
  });

  return {
    ok: true,
    code: "list_created",
    message: `Created list ${list.id}: ${list.title}`,
    data: { list },
  };
}

export async function listLists(
  stateDir: string,
  pluginConfig: ClawCollectPluginConfig,
): Promise<
  ClawCollectActionResult<{
    lists: Checklist[];
  }>
> {
  const store = await loadStore(stateDir, pluginConfig);
  if (store.lists.length === 0) {
    return {
      ok: true,
      code: "empty_lists",
      message: "No lists yet.",
      data: { lists: [] },
    };
  }

  return {
    ok: true,
    code: "list_overview",
    message: store.lists.map(summarizeChecklist).join("\n"),
    data: { lists: store.lists },
  };
}

export async function showList(
  stateDir: string,
  pluginConfig: ClawCollectPluginConfig,
  listId: string,
): Promise<
  ClawCollectActionResult<{
    list: Checklist;
  }>
> {
  const store = await loadStore(stateDir, pluginConfig);
  const list = findByIdPrefix(store.lists, listId);
  if (!list) {
    return {
      ok: false,
      code: "list_not_found",
      message: `List not found: ${listId}`,
    };
  }

  return {
    ok: true,
    code: "list_detail",
    message: renderChecklist(list),
    data: { list },
  };
}

export async function addItemToList(
  stateDir: string,
  pluginConfig: ClawCollectPluginConfig,
  listId: string,
  itemText: string,
): Promise<
  ClawCollectActionResult<{
    list: Checklist;
    itemId: string;
  }>
> {
  const trimmedText = itemText.trim();
  if (!trimmedText) {
    return {
      ok: false,
      code: "invalid_item_text",
      message: "Item text is required.",
    };
  }

  const result = await updateStore(stateDir, pluginConfig, (store) => {
    const list = findByIdPrefix(store.lists, listId);
    if (!list) {
      return { error: `List not found: ${listId}` };
    }

    const item = appendManualItem(list, trimmedText);
    return {
      list,
      itemId: item.id,
    };
  });

  if ("error" in result) {
    return {
      ok: false,
      code: "list_not_found",
      message: result.error ?? `List not found: ${listId}`,
    };
  }

  return {
    ok: true,
    code: "list_item_added",
    message: `Added item ${result.itemId} to ${result.list.title}`,
    data: result,
  };
}

export async function checkListItem(
  stateDir: string,
  pluginConfig: ClawCollectPluginConfig,
  listId: string,
  itemId: string,
): Promise<
  ClawCollectActionResult<{
    list: Checklist;
    itemText: string;
  }>
> {
  const result = await updateStore(stateDir, pluginConfig, (store) => {
    const list = findByIdPrefix(store.lists, listId);
    if (!list) {
      return { error: `List not found: ${listId}` };
    }

    const item = findByIdPrefix(list.items, itemId);
    if (!item) {
      return { error: `Item not found: ${itemId}` };
    }

    item.status = "done";
    item.updatedAt = new Date().toISOString();
    list.updatedAt = item.updatedAt;
    return {
      list,
      itemText: item.text,
    };
  });

  if ("error" in result) {
    return {
      ok: false,
      code: "list_item_not_found",
      message: result.error ?? `Item not found: ${itemId}`,
    };
  }

  return {
    ok: true,
    code: "list_item_checked",
    message: `Checked ${result.itemText} in ${result.list.title}`,
    data: result,
  };
}

export async function createReminderEntry(
  stateDir: string,
  pluginConfig: ClawCollectPluginConfig,
  dueAtRaw: string,
  title: string,
  listId?: string,
  timeZone?: string,
  originScopeKey?: string,
): Promise<
  ClawCollectActionResult<{
    reminder: Reminder;
  }>
> {
  const dueAt = parseDueAt(dueAtRaw, timeZone);
  if (!dueAt) {
    return {
      ok: false,
      code: "invalid_due_at",
      message: `Could not parse datetime: ${dueAtRaw}`,
    };
  }

  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    return {
      ok: false,
      code: "invalid_title",
      message: "Reminder title is required.",
    };
  }

  const result = await updateStore(stateDir, pluginConfig, (store) => {
    let relatedListId: string | undefined;
    if (listId?.trim()) {
      const relatedList = findByIdPrefix(store.lists, listId);
      if (!relatedList) {
        return { error: `List not found: ${listId}` };
      }
      relatedListId = relatedList.id;
    }

    const reminder = createReminder(
      trimmedTitle,
      dueAt,
      relatedListId,
      undefined,
      timeZone,
      originScopeKey,
    );
    store.reminders.push(reminder);
    return { reminder };
  });

  if ("error" in result) {
    return {
      ok: false,
      code: "list_not_found",
      message: result.error ?? `List not found: ${listId}`,
    };
  }

  return {
    ok: true,
    code: "reminder_created",
    message: `Created reminder ${result.reminder.id} at ${formatTimestamp(result.reminder.dueAt, result.reminder.timezone)}`,
    data: result,
  };
}

export async function listReminders(
  stateDir: string,
  pluginConfig: ClawCollectPluginConfig,
  fallbackTimeZone?: string,
): Promise<
  ClawCollectActionResult<{
    reminders: Reminder[];
  }>
> {
  const store = await loadStore(stateDir, pluginConfig);
  if (store.reminders.length === 0) {
    return {
      ok: true,
      code: "empty_reminders",
      message: "No reminders yet.",
      data: { reminders: [] },
    };
  }

  const sorted = store.reminders
    .slice()
    .sort((left, right) => left.dueAt.localeCompare(right.dueAt));

  return {
    ok: true,
    code: "reminder_overview",
    message: sorted
      .map((reminder) =>
        renderReminder(
          {
            ...reminder,
            timezone: reminder.timezone ?? fallbackTimeZone,
          },
          store.lists.find((list) => list.id === reminder.relatedListId),
          fallbackTimeZone,
        ),
      )
      .join("\n"),
    data: { reminders: sorted },
  };
}
