import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

import {
  makeId,
  nowIso,
  splitFirstWord,
  textReply,
} from "./helpers";
import { OnlineClient, OnlineServiceError } from "./online-client";
import { loadStore, resolveStorePath, updateStore } from "./storage";
import { resolveCommandScope } from "./scope";
import type {
  LifeCommandContext,
  ClawCollectPluginConfig,
  ClawCollectStore,
  OnlineCollection,
} from "./types";

function formatHelp(): string {
  return [
    "ClawCollect — form collection bridge:",
    "",
    "/collect",
    "/collect help",
    "/collect status",
    "/collect doctor",
    "",
    "/collect form open <title>",
    "/collect form status",
    "/collect form summary",
    "/collect form close",
  ].join("\n");
}

function renderQuickActions(): string {
  return [
    "Quick actions:",
    "- /collect form open BBQ Friday",
    "- /collect form status",
    "- /collect doctor",
  ].join("\n");
}

function renderStatus(currentScopeKey: string, store: ClawCollectStore): string {
  const activeFormCollections = store.onlineCollections.filter(
    (c) => c.scopeKey === currentScopeKey && c.status === "open",
  ).length;
  const totalForms = store.onlineCollections.length;

  return [
    "ClawCollect status:",
    `- active form collections here: ${activeFormCollections}`,
    `- total form collections: ${totalForms}`,
  ].join("\n");
}

function renderLanding(currentScopeKey: string, store: ClawCollectStore): string {
  return [renderStatus(currentScopeKey, store), "", renderQuickActions()].join("\n");
}

function renderDoctor(
  currentScopeKey: string,
  stateDir: string,
  pluginConfig: ClawCollectPluginConfig,
  store: ClawCollectStore,
): string {
  const storePath = resolveStorePath(stateDir, pluginConfig);
  const activeHere = store.onlineCollections.filter(
    (c) => c.scopeKey === currentScopeKey && c.status === "open",
  ).length;
  const totalOpen = store.onlineCollections.filter(
    (c) => c.status === "open",
  ).length;

  return [
    "ClawCollect doctor:",
    `- store path: ${storePath}`,
    `- schema version: ${store.version}`,
    `- online service: ${pluginConfig.online?.enabled ? "enabled" : "not configured"}`,
    `- online API URL: ${pluginConfig.online?.apiUrl ?? "(not set)"}`,
    `- active form collections here: ${activeHere}`,
    `- active form collections total: ${totalOpen}`,
    `- total form collections: ${store.onlineCollections.length}`,
  ].join("\n");
}

export function registerClawCollectCommands(
  api: OpenClawPluginApi,
  pluginConfig: ClawCollectPluginConfig,
): void {
  api.registerCommand({
    name: "collect",
    description: "OpenClaw bridge for hosted form collection.",
    acceptsArgs: true,
    handler: async (ctx) => {
      const commandCtx = ctx as LifeCommandContext;
      const args = commandCtx.args?.trim() ?? "";
      const stateDir = api.runtime.state.resolveStateDir();
      const scope = resolveCommandScope(commandCtx);
      const scopeKey = scope?.scopeKey ?? "unknown:default:direct:user:unknown";

      if (!args) {
        const store = await loadStore(stateDir, pluginConfig);
        return textReply(renderLanding(scopeKey, store));
      }

      if (args === "help") {
        return textReply(formatHelp());
      }

      const { head: section, tail: sectionArgs } = splitFirstWord(args);

      if (section === "status") {
        const store = await loadStore(stateDir, pluginConfig);
        return textReply(renderStatus(scopeKey, store));
      }

      if (section === "doctor") {
        const store = await loadStore(stateDir, pluginConfig);
        return textReply(renderDoctor(scopeKey, stateDir, pluginConfig, store));
      }

      if (section === "form") {
        return handleFormCommand(
          pluginConfig,
          stateDir,
          scopeKey,
          sectionArgs,
        );
      }

      return textReply(formatHelp());
    },
  });
}

// ── Form collection commands ───────────────────────────────────────

function resolveOnlineClient(
  pluginConfig: ClawCollectPluginConfig,
): OnlineClient | string {
  if (!pluginConfig.online?.enabled) {
    return "Form collection is not enabled.\nAdd to your config:\n  online: { enabled: true, apiUrl: \"...\", apiToken: \"...\" }";
  }
  if (!pluginConfig.online.apiUrl?.trim()) {
    return "Missing online.apiUrl in plugin config.";
  }
  if (!pluginConfig.online.apiToken?.trim()) {
    return "Missing online.apiToken in plugin config.\nCreate one via POST /api/tokens on your online service.";
  }
  return new OnlineClient({
    apiUrl: pluginConfig.online.apiUrl,
    apiToken: pluginConfig.online.apiToken,
  });
}

function formatOnlineError(err: unknown): string {
  if (err instanceof OnlineServiceError) {
    if (err.status === 401 || err.status === 403) {
      return `Auth failed: ${err.serverMessage}\nCheck your online.apiToken in plugin config.`;
    }
    if (err.status === 404) {
      return `Not found: ${err.serverMessage}\nThe remote form may have been deleted.`;
    }
    return `Online service error (${err.status}): ${err.serverMessage}`;
  }
  if (err instanceof Error) {
    return `Failed to reach online service: ${err.message}`;
  }
  return `Unexpected error: ${String(err)}`;
}

function resolveOnlineBaseUrl(pluginConfig: ClawCollectPluginConfig): string {
  return pluginConfig.online!.apiUrl!.replace(/\/+$/, "");
}

async function tryResolveResultsUrl(
  client: OnlineClient,
  pluginConfig: ClawCollectPluginConfig,
  formId: string,
): Promise<string | null> {
  try {
    const resultsLink = await client.ensureResultsLink(formId);
    return `${resolveOnlineBaseUrl(pluginConfig)}${resultsLink.url}`;
  } catch {
    return null;
  }
}

function findActiveOnlineCollection(
  scopeKey: string,
  store: ClawCollectStore,
): OnlineCollection | undefined {
  return store.onlineCollections.find(
    (c) => c.scopeKey === scopeKey && c.status === "open",
  );
}

const DEFAULT_ONLINE_SCHEMA = [
  { id: "name", type: "text", label: "Name" },
  { id: "response", type: "textarea", label: "Response", required: true },
];

async function handleFormCommand(
  pluginConfig: ClawCollectPluginConfig,
  stateDir: string,
  scopeKey: string,
  args: string,
): Promise<{ text: string }> {
  const { head: action, tail } = splitFirstWord(args);

  if (!action || action === "help") {
    return textReply(
      [
        "Form collection commands:",
        "/collect form open <title>",
        "/collect form status",
        "/collect form summary",
        "/collect form close",
        "",
        "Requires online config: online.enabled, online.apiUrl, online.apiToken",
      ].join("\n"),
    );
  }

  if (action === "open") {
    if (!tail.trim()) {
      return textReply("Usage: /collect form open <title>");
    }

    const client = resolveOnlineClient(pluginConfig);
    if (typeof client === "string") return textReply(client);

    // Check for existing open collection
    const store = await loadStore(stateDir, pluginConfig);
    const existing = findActiveOnlineCollection(scopeKey, store);
    if (existing) {
      return textReply(
        `Already have an open form collection: "${existing.title}"\nLink: ${existing.remoteLinkUrl}\nClose it first with /collect form close`,
      );
    }

    try {
      const title = tail.trim();

      // Create form with minimal schema
      const form = await client.createForm({
        title,
        schema: DEFAULT_ONLINE_SCHEMA,
        settings: { allow_response_edit: true },
      });

      // Publish
      await client.publishForm(form.id);

      // Create public link
      const link = await client.createLink(form.id, "private");
      const fullLinkUrl = `${resolveOnlineBaseUrl(pluginConfig)}${link.url}`;
      const resultsUrl = await tryResolveResultsUrl(client, pluginConfig, form.id);

      // Persist to local store
      const now = nowIso();
      const entry: OnlineCollection = {
        id: makeId("ocol"),
        scopeKey,
        title,
        remoteFormId: form.id,
        remoteLinkUrl: fullLinkUrl,
        status: "open",
        createdAt: now,
        updatedAt: now,
        lastKnownResponsesCount: 0,
      };

      await updateStore(stateDir, pluginConfig, (s) => {
        s.onlineCollections.push(entry);
      });

      return textReply(
        [
          `Form collection opened: ${title}`,
          `Form ID: ${form.id}`,
          `Public link: ${fullLinkUrl}`,
          ...(resultsUrl ? [`Results page: ${resultsUrl}`] : []),
          "",
          "Share this link for people to submit responses.",
          "Use /collect form status to check progress.",
        ].join("\n"),
      );
    } catch (err) {
      return textReply(formatOnlineError(err));
    }
  }

  if (action === "status") {
    const client = resolveOnlineClient(pluginConfig);
    if (typeof client === "string") return textReply(client);

    const store = await loadStore(stateDir, pluginConfig);
    const entry = findActiveOnlineCollection(scopeKey, store);
    if (!entry) {
      return textReply(
        "No active form collection here.\nStart one with /collect form open <title>",
      );
    }

    try {
      const { form } = await client.getForm(entry.remoteFormId);
      const resultsUrl = await tryResolveResultsUrl(client, pluginConfig, entry.remoteFormId);

      // Update cached count
      await updateStore(stateDir, pluginConfig, (s) => {
        const found = s.onlineCollections.find((c) => c.id === entry.id);
        if (found) {
          found.lastKnownResponsesCount = form.responses_count;
          found.updatedAt = nowIso();
        }
      });

      return textReply(
        [
          `Form collection: ${entry.title}`,
          `Status: ${form.status}`,
          `Responses: ${form.responses_count}`,
          `Form ID: ${entry.remoteFormId}`,
          `Link: ${entry.remoteLinkUrl}`,
          ...(resultsUrl ? [`Results page: ${resultsUrl}`] : []),
        ].join("\n"),
      );
    } catch (err) {
      return textReply(formatOnlineError(err));
    }
  }

  if (action === "summary") {
    const client = resolveOnlineClient(pluginConfig);
    if (typeof client === "string") return textReply(client);

    const store = await loadStore(stateDir, pluginConfig);
    const entry = findActiveOnlineCollection(scopeKey, store);
    if (!entry) {
      return textReply(
        "No active form collection here.\nStart one with /collect form open <title>",
      );
    }

    try {
      const page = await client.listResponses(entry.remoteFormId, {
        limit: 50,
        status: "accepted",
      });
      const resultsUrl = await tryResolveResultsUrl(client, pluginConfig, entry.remoteFormId);

      if (page.total === 0) {
        return textReply(
          [
            `Form collection: ${entry.title}`,
            "No responses yet.",
            ...(resultsUrl ? [`Results page: ${resultsUrl}`] : []),
          ].join("\n"),
        );
      }

      const lines: string[] = [
        `Form collection: ${entry.title}`,
        `Total accepted responses: ${page.total}`,
        "",
      ];

      for (const resp of page.responses) {
        const data = resp.data;
        const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : undefined;
        const response = typeof data.response === "string" ? data.response.trim() : undefined;

        if (name && response) {
          lines.push(`- ${name}: ${response}`);
        } else if (response) {
          lines.push(`- ${response}`);
        } else {
          // Fallback: render all key-value pairs
          const kvParts = Object.entries(data)
            .filter(([, v]) => v !== null && v !== undefined && v !== "")
            .map(([k, v]) => `${k}: ${String(v)}`)
            .join(", ");
          lines.push(`- ${kvParts || "(empty)"}`);
        }
      }

      if (page.total > page.responses.length) {
        lines.push(`\n... and ${page.total - page.responses.length} more.`);
      }

      if (resultsUrl) {
        lines.push("", `Results page: ${resultsUrl}`);
      }

      // Update cached count
      await updateStore(stateDir, pluginConfig, (s) => {
        const found = s.onlineCollections.find((c) => c.id === entry.id);
        if (found) {
          found.lastKnownResponsesCount = page.total;
          found.updatedAt = nowIso();
        }
      });

      return textReply(lines.join("\n"));
    } catch (err) {
      return textReply(formatOnlineError(err));
    }
  }

  if (action === "close") {
    const client = resolveOnlineClient(pluginConfig);
    if (typeof client === "string") return textReply(client);

    const store = await loadStore(stateDir, pluginConfig);
    const entry = findActiveOnlineCollection(scopeKey, store);
    if (!entry) {
      return textReply(
        "No active form collection here.\nNothing to close.",
      );
    }

    try {
      await client.closeForm(entry.remoteFormId);
    } catch (err) {
      // If already closed remotely, still update local state
      if (!(err instanceof OnlineServiceError && err.status === 400)) {
        return textReply(formatOnlineError(err));
      }
    }

    await updateStore(stateDir, pluginConfig, (s) => {
      const found = s.onlineCollections.find((c) => c.id === entry.id);
      if (found) {
        found.status = "closed";
        found.updatedAt = nowIso();
      }
    });

    return textReply(
      `Form collection closed: ${entry.title}\nForm ID: ${entry.remoteFormId}`,
    );
  }

  return textReply("Unknown form action. Try /collect form help");
}
