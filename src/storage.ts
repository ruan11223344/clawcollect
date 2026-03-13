import fs from "node:fs/promises";
import path from "node:path";

import { createDefaultStore } from "./domain";
import type { CollectionStatus, OnlineCollectionStatus, ClawCollectPluginConfig, ClawCollectStore } from "./types";

let updateQueue: Promise<void> = Promise.resolve();

export function resolveStorePath(
  stateDir: string,
  pluginConfig?: ClawCollectPluginConfig,
): string {
  const configuredPath = pluginConfig?.storage?.filePath?.trim();
  if (configuredPath) {
    if (path.isAbsolute(configuredPath)) {
      return configuredPath;
    }
    return path.join(stateDir, configuredPath);
  }
  return path.join(stateDir, "plugins", "clawcollect", "store.json");
}

/** Legacy path for backward-compatible store loading. */
function resolveLegacyStorePath(stateDir: string): string {
  return path.join(stateDir, "plugins", "lifehub", "store.json");
}

export async function loadStore(
  stateDir: string,
  pluginConfig?: ClawCollectPluginConfig,
): Promise<ClawCollectStore> {
  const storePath = resolveStorePath(stateDir, pluginConfig);

  let raw: string | undefined;
  try {
    raw = await fs.readFile(storePath, "utf8");
  } catch {
    // If the canonical path does not exist and no custom path is configured,
    // try the legacy lifehub path for backward compatibility.
    if (!pluginConfig?.storage?.filePath?.trim()) {
      const legacyPath = resolveLegacyStorePath(stateDir);
      if (legacyPath !== storePath) {
        try {
          raw = await fs.readFile(legacyPath, "utf8");
        } catch {
          // neither path exists
        }
      }
    }
  }

  if (!raw) {
    return createDefaultStore();
  }

  try {
    const parsed = JSON.parse(raw) as Omit<
      Partial<ClawCollectStore>,
      "version" | "dispatches" | "collectionSessions" | "captures"
    > & {
      version?: number;
      collectionSessions?: Array<
        Partial<ClawCollectStore["collectionSessions"][number]> & {
          conversationKey?: string;
        }
      >;
      captures?: Array<
        Partial<ClawCollectStore["captures"][number]> & {
          conversationKey?: string;
        }
      >;
      onboarding?: {
        sentTargets?: Record<string, string>;
      };
      dispatches?: {
        sent?: Record<string, string>;
      };
    };

    if (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3 && parsed.version !== 4) {
      return createDefaultStore();
    }

    const legacySentTargets = parsed.onboarding?.sentTargets ?? {};
    const migratedDispatches = Object.fromEntries(
      Object.entries(legacySentTargets).map(([targetKey, sentAt]) => [
        `intro:openclaw_message:${targetKey}:intro`,
        sentAt,
      ]),
    );
    const dispatches = {
      sent: {
        ...migratedDispatches,
        ...(parsed.dispatches?.sent ?? {}),
      },
    };

    const collectionSessions: ClawCollectStore["collectionSessions"] = Array.isArray(
      parsed.collectionSessions,
    )
      ? parsed.collectionSessions
          .filter((entry) => entry && typeof entry === "object")
          .map((entry) => {
            const scopeKey =
              typeof entry.scopeKey === "string" && entry.scopeKey.trim()
                ? entry.scopeKey.trim()
                : typeof entry.conversationKey === "string" && entry.conversationKey.trim()
                  ? entry.conversationKey.trim()
                  : "";
            const status: CollectionStatus = entry.status === "closed" ? "closed" : "open";
            return {
              id: typeof entry.id === "string" ? entry.id : "",
              title: typeof entry.title === "string" ? entry.title : "",
              listId: typeof entry.listId === "string" ? entry.listId : "",
              scopeKey,
              status,
              boundary:
                entry.boundary === "informational" ||
                entry.boundary === "reminder_only" ||
                entry.boundary === "organizational" ||
                entry.boundary === "sensitive" ||
                entry.boundary === "transactional"
                  ? entry.boundary
                  : undefined,
              risk:
                entry.risk === "low" || entry.risk === "medium" || entry.risk === "high"
                  ? entry.risk
                  : undefined,
              approved: entry.approved === true,
              createdAt: typeof entry.createdAt === "string" ? entry.createdAt : "",
              updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : "",
            };
          })
          .filter((entry) => entry.id && entry.listId && entry.scopeKey)
      : [];

    const captures: ClawCollectStore["captures"] = Array.isArray(parsed.captures)
      ? parsed.captures
          .filter((entry) => entry && typeof entry === "object")
          .map((entry) => {
            const scopeKey =
              typeof entry.scopeKey === "string" && entry.scopeKey.trim()
                ? entry.scopeKey.trim()
                : typeof entry.conversationKey === "string" && entry.conversationKey.trim()
                  ? entry.conversationKey.trim()
                  : "";
            return {
              id: typeof entry.id === "string" ? entry.id : "",
              scopeKey,
              from: typeof entry.from === "string" ? entry.from : "unknown",
              content: typeof entry.content === "string" ? entry.content : "",
              extractedItems: Array.isArray(entry.extractedItems)
                ? entry.extractedItems.filter(
                    (item): item is string => typeof item === "string" && item.trim().length > 0,
                  )
                : [],
              assets: Array.isArray(entry.assets)
                ? entry.assets.filter(
                    (asset): asset is ClawCollectStore["captures"][number]["assets"][number] =>
                      Boolean(asset) && typeof asset === "object",
                  )
                : [],
              capturedAt:
                typeof entry.capturedAt === "string" ? entry.capturedAt : new Date().toISOString(),
            };
          })
          .filter((entry) => entry.id && entry.scopeKey)
      : [];

    const lists: ClawCollectStore["lists"] = Array.isArray(parsed.lists)
      ? parsed.lists
          .filter((entry) => entry && typeof entry === "object")
          .map((entry) => ({
            id: typeof entry.id === "string" ? entry.id : "",
            title: typeof entry.title === "string" ? entry.title : "",
            kind:
              typeof entry.kind === "string" && entry.kind.trim() ? entry.kind.trim() : undefined,
            items: Array.isArray(entry.items) ? entry.items : [],
            createdAt: typeof entry.createdAt === "string" ? entry.createdAt : "",
            updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : "",
          }))
          .filter((entry) => entry.id && entry.title)
      : [];

    const reminders: ClawCollectStore["reminders"] = Array.isArray(parsed.reminders)
      ? parsed.reminders
          .filter((entry) => entry && typeof entry === "object")
          .map((entry) => {
            const status: ClawCollectStore["reminders"][number]["status"] =
              entry.status === "done" || entry.status === "due" ? entry.status : "pending";
            return {
              id: typeof entry.id === "string" ? entry.id : "",
              title: typeof entry.title === "string" ? entry.title : "",
              dueAt: typeof entry.dueAt === "string" ? entry.dueAt : "",
              timezone:
                typeof entry.timezone === "string" && entry.timezone.trim()
                  ? entry.timezone.trim()
                  : undefined,
              originScopeKey:
                typeof entry.originScopeKey === "string" && entry.originScopeKey.trim()
                  ? entry.originScopeKey.trim()
                  : undefined,
              status,
              relatedListId:
                typeof entry.relatedListId === "string" && entry.relatedListId.trim()
                  ? entry.relatedListId.trim()
                  : undefined,
              note:
                typeof entry.note === "string" && entry.note.trim() ? entry.note.trim() : undefined,
              delivery:
                entry.delivery && typeof entry.delivery === "object"
                  ? {
                      attemptCount:
                        typeof entry.delivery.attemptCount === "number"
                          ? Math.max(0, Math.floor(entry.delivery.attemptCount))
                          : 0,
                      lastAttemptAt:
                        typeof entry.delivery.lastAttemptAt === "string"
                          ? entry.delivery.lastAttemptAt
                          : undefined,
                      nextAttemptAt:
                        typeof entry.delivery.nextAttemptAt === "string"
                          ? entry.delivery.nextAttemptAt
                          : undefined,
                      lastError:
                        typeof entry.delivery.lastError === "string"
                          ? entry.delivery.lastError
                          : undefined,
                      completedAt:
                        typeof entry.delivery.completedAt === "string"
                          ? entry.delivery.completedAt
                          : undefined,
                    }
                  : { attemptCount: 0 },
              createdAt: typeof entry.createdAt === "string" ? entry.createdAt : "",
              updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : "",
            };
          })
          .filter((entry) => entry.id && entry.title && entry.dueAt)
      : [];

    const onlineCollections: ClawCollectStore["onlineCollections"] = Array.isArray(
      (parsed as Record<string, unknown>).onlineCollections,
    )
      ? ((parsed as Record<string, unknown>).onlineCollections as Array<Record<string, unknown>>)
          .filter((entry) => entry && typeof entry === "object")
          .map((entry) => {
            const status: OnlineCollectionStatus = entry.status === "closed" ? "closed" : "open";
            return {
              id: typeof entry.id === "string" ? entry.id : "",
              scopeKey: typeof entry.scopeKey === "string" ? entry.scopeKey : "",
              title: typeof entry.title === "string" ? entry.title : "",
              remoteFormId: typeof entry.remoteFormId === "string" ? entry.remoteFormId : "",
              remoteLinkUrl: typeof entry.remoteLinkUrl === "string" ? entry.remoteLinkUrl : "",
              status,
              createdAt: typeof entry.createdAt === "string" ? entry.createdAt : "",
              updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : "",
              lastKnownResponsesCount:
                typeof entry.lastKnownResponsesCount === "number" ? entry.lastKnownResponsesCount : 0,
            };
          })
          .filter((entry) => entry.id && entry.scopeKey && entry.remoteFormId)
      : [];

    return {
      version: 4,
      lists,
      reminders,
      collectionSessions,
      captures,
      onlineCollections,
      dispatches,
    };
  } catch {
    return createDefaultStore();
  }
}

export async function saveStore(
  stateDir: string,
  pluginConfig: ClawCollectPluginConfig | undefined,
  store: ClawCollectStore,
): Promise<void> {
  const storePath = resolveStorePath(stateDir, pluginConfig);
  await fs.mkdir(path.dirname(storePath), { recursive: true });

  const tempPath = `${storePath}.tmp`;
  const payload = `${JSON.stringify(store, null, 2)}\n`;
  await fs.writeFile(tempPath, payload, "utf8");
  await fs.rename(tempPath, storePath);
}

export async function updateStore<T>(
  stateDir: string,
  pluginConfig: ClawCollectPluginConfig | undefined,
  updater: (store: ClawCollectStore) => Promise<T> | T,
): Promise<T> {
  let result!: T;
  const task = updateQueue.then(async () => {
    const store = await loadStore(stateDir, pluginConfig);
    result = await updater(store);
    await saveStore(stateDir, pluginConfig, store);
  });

  updateQueue = task.then(
    () => undefined,
    () => undefined,
  );

  await task;
  return result;
}
