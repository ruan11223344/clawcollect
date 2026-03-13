import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

import {
  makeId,
  nowIso,
  splitPipeArgs,
  splitFirstWord,
  textReply,
} from "./helpers.js";
import { OnlineClient, OnlineServiceError } from "./online-client.js";
import { loadStore, resolveStorePath, updateStore } from "./storage.js";
import { resolveCommandScope } from "./scope.js";
import type {
  LifeCommandContext,
  ClawCollectPluginConfig,
  ClawCollectStore,
  OnlineCollection,
} from "./types.js";

const DEFAULT_HOSTED_API_URL = "https://collect.dorapush.com";
const DEFAULT_HOSTED_SIGNUP_URL = `${DEFAULT_HOSTED_API_URL}/signup`;
const ONLINE_CONFIG_PATH_PREFIX = "plugins.entries.clawcollect.config.online";
const CONNECT_TOKEN_PATTERN = /\bcc_tok_[A-Za-z0-9]+\b/;
const execFileAsync = promisify(execFile);

function formatHelp(): string {
  return [
    "ClawCollect — form collection bridge:",
    "",
    "/collect",
    "/collect help",
    "/collect connect",
    "/collect status",
    "/collect doctor",
    "",
    "/collect connect hosted <workspace name> | <owner email> | [owner name] | [signup code]",
    "/collect connect token <cc_tok_...>",
    "/collect connect check",
    "/collect form open <title>",
    "/collect form status",
    "/collect form summary",
    "/collect form close",
  ].join("\n");
}

function renderQuickActions(): string {
  return [
    "Quick actions:",
    "- /collect connect",
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
    `- online API token: ${pluginConfig.online?.apiToken?.trim() ? "configured" : "not set"}`,
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

      if (section === "connect") {
        return handleConnectCommand(
          pluginConfig,
          sectionArgs,
          commandCtx.isAuthorizedSender,
        );
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
    return "Form collection is not enabled.\nRun /collect connect for hosted setup, or add online.enabled/apiUrl/apiToken to plugin config.";
  }
  if (!pluginConfig.online.apiUrl?.trim()) {
    return "Missing online.apiUrl in plugin config.\nRun /collect connect token <cc_tok_...> for hosted setup, or set a self-hosted API URL.";
  }
  if (!pluginConfig.online.apiToken?.trim()) {
    return "Missing online.apiToken in plugin config.\nRun /collect connect for hosted setup, or create one on your self-hosted service.";
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

function quoteConfigValue(value: string): string {
  return JSON.stringify(value);
}

function normalizeConfiguredApiUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function normalizeDetectedApiUrl(value: string): string {
  try {
    return new URL(value.trim()).origin;
  } catch {
    return normalizeConfiguredApiUrl(value);
  }
}

function extractApiTokenFromText(input: string): string | null {
  const keyedMatch = input.match(
    /(?:apiToken|api_token)\s*[:=]\s*["']?(cc_tok_[A-Za-z0-9]+)["']?/i,
  );
  if (keyedMatch?.[1]) {
    return keyedMatch[1];
  }
  return input.match(CONNECT_TOKEN_PATTERN)?.[0] ?? null;
}

function extractApiUrlFromText(input: string): string | null {
  const keyedMatch = input.match(
    /(?:apiUrl|api_url)\s*[:=]\s*["']?(https?:\/\/[^\s"'`,}<>]+)["']?/i,
  );
  if (keyedMatch?.[1]) {
    return normalizeConfiguredApiUrl(keyedMatch[1]);
  }

  const firstUrl = input.match(/https?:\/\/[^\s"'`<>]+/i)?.[0];
  if (!firstUrl) {
    return null;
  }
  return normalizeDetectedApiUrl(firstUrl);
}

function parseConnectConfigInput(
  input: string,
): { apiUrl: string; apiToken: string } | null {
  const apiToken = extractApiTokenFromText(input);
  if (!apiToken) {
    return null;
  }

  return {
    apiUrl: extractApiUrlFromText(input) ?? DEFAULT_HOSTED_API_URL,
    apiToken,
  };
}

function renderConfigCommands(apiUrl: string, apiToken: string): string[] {
  return [
    `/config set plugins.entries.clawcollect.enabled true`,
    `/config set ${ONLINE_CONFIG_PATH_PREFIX}.enabled true`,
    `/config set ${ONLINE_CONFIG_PATH_PREFIX}.apiUrl ${quoteConfigValue(apiUrl)}`,
    `/config set ${ONLINE_CONFIG_PATH_PREFIX}.apiToken ${quoteConfigValue(apiToken)}`,
    "/restart",
    "/collect connect check",
  ];
}

function renderHostedConnectGuide(): string {
  return [
    "ClawCollect hosted setup:",
    `1. Fast path in chat: /collect connect hosted <workspace name> | <owner email>`,
    `2. Browser fallback: open ${DEFAULT_HOSTED_SIGNUP_URL}`,
    "3. Paste the signup success config block into: /collect connect <...>",
    "",
    "Advanced self-hosted setup:",
    "- /collect connect custom <apiUrl> <cc_tok_...>",
  ].join("\n");
}

function renderConnectCommandsReply(apiUrl: string, apiToken: string): string {
  return [
    "Run these commands in OpenClaw chat:",
    ...renderConfigCommands(apiUrl, apiToken),
    "",
    "This writes your plugin config, restarts the daemon, and then checks connectivity.",
  ].join("\n");
}

function shouldSkipOpenClawConfigWrite(): boolean {
  return process.env.CLAWCOLLECT_SKIP_OPENCLAW_CONFIG_WRITE === "1";
}

async function verifyOnlineConfig(config: {
  apiUrl: string;
  apiToken: string;
}): Promise<number> {
  const client = new OnlineClient(config);
  const page = await client.listForms();
  return page.forms.length;
}

async function runOpenClawCli(args: string[]): Promise<void> {
  const candidates: Array<{ file: string; args: string[] }> = [
    { file: "openclaw", args },
  ];

  if (process.argv[1]?.trim()) {
    candidates.push({
      file: process.execPath,
      args: [process.argv[1], ...args],
    });
  }

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate.file, candidate.args, {
        env: process.env,
        timeout: 20_000,
      });
      return;
    } catch (error) {
      lastError = error;
      const code =
        typeof error === "object" && error && "code" in error
          ? String((error as { code?: unknown }).code)
          : "";
      if (code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error("OpenClaw CLI is not available");
}

async function applyOnlineConfigToOpenClaw(config: {
  apiUrl: string;
  apiToken: string;
}): Promise<void> {
  await runOpenClawCli([
    "config",
    "set",
    "--strict-json",
    "plugins.entries.clawcollect.enabled",
    JSON.stringify(true),
  ]);
  await runOpenClawCli([
    "config",
    "set",
    "--strict-json",
    ONLINE_CONFIG_PATH_PREFIX,
    JSON.stringify({
      enabled: true,
      apiUrl: config.apiUrl,
      apiToken: config.apiToken,
    }),
  ]);
}

async function signupHostedWorkspace(input: {
  workspaceName: string;
  ownerEmail: string;
  ownerName?: string;
  signupCode?: string;
}): Promise<{
  workspaceName: string;
  ownerEmail: string;
  apiUrl: string;
  apiToken: string;
}> {
  const body = new URLSearchParams();
  body.set("workspaceName", input.workspaceName);
  body.set("ownerEmail", input.ownerEmail);
  if (input.ownerName?.trim()) {
    body.set("ownerName", input.ownerName.trim());
  }
  if (input.signupCode?.trim()) {
    body.set("signupCode", input.signupCode.trim());
  }

  let res: Response;
  try {
    res = await fetch(`${DEFAULT_HOSTED_SIGNUP_URL}?format=json`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: body.toString(),
    });
  } catch (error) {
    throw new Error(
      `Failed to reach hosted signup at ${DEFAULT_HOSTED_SIGNUP_URL}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // ignore JSON parse failure below
  }

  if (!res.ok) {
    const message =
      typeof payload === "object" &&
      payload &&
      "error" in payload &&
      typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : `HTTP ${res.status}`;
    throw new Error(`Hosted signup failed: ${message}`);
  }

  const data = payload as {
    workspace?: { name?: string };
    owner?: { email?: string };
    config?: {
      online?: {
        apiUrl?: string;
        apiToken?: string;
      };
    };
  };

  const apiUrl = data.config?.online?.apiUrl?.trim();
  const apiToken = data.config?.online?.apiToken?.trim();
  if (!apiUrl || !apiToken) {
    throw new Error("Hosted signup succeeded but did not return online config");
  }

  return {
    workspaceName: data.workspace?.name?.trim() || input.workspaceName,
    ownerEmail: data.owner?.email?.trim() || input.ownerEmail,
    apiUrl,
    apiToken,
  };
}

async function renderAutoConnectReply(
  config: { apiUrl: string; apiToken: string },
  options?: { workspaceName?: string; ownerEmail?: string },
): Promise<string> {
  const formsCount = await verifyOnlineConfig(config);

  if (shouldSkipOpenClawConfigWrite()) {
    return [
      "ClawCollect verified your online access.",
      ...(options?.workspaceName ? [`- workspace: ${options.workspaceName}`] : []),
      ...(options?.ownerEmail ? [`- owner: ${options.ownerEmail}`] : []),
      `- apiUrl: ${config.apiUrl}`,
      "- auth: ok",
      `- forms visible in this workspace: ${formsCount}`,
      "- local config: skipped (CLAWCOLLECT_SKIP_OPENCLAW_CONFIG_WRITE=1)",
      "",
      renderConnectCommandsReply(config.apiUrl, config.apiToken),
    ].join("\n");
  }

  try {
    await applyOnlineConfigToOpenClaw(config);
    return [
      "ClawCollect connect is ready.",
      ...(options?.workspaceName ? [`- workspace: ${options.workspaceName}`] : []),
      ...(options?.ownerEmail ? [`- owner: ${options.ownerEmail}`] : []),
      `- apiUrl: ${config.apiUrl}`,
      "- auth: ok",
      `- forms visible in this workspace: ${formsCount}`,
      "- local config: written",
      "",
      "Run /restart now.",
      "After restart: /collect connect check",
      "Then: /collect form open BBQ Friday",
    ].join("\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
      "ClawCollect verified your online access, but could not write OpenClaw config automatically.",
      `Reason: ${message}`,
      "",
      renderConnectCommandsReply(config.apiUrl, config.apiToken),
    ].join("\n");
  }
}

async function handleConnectCommand(
  pluginConfig: ClawCollectPluginConfig,
  args: string,
  isAuthorizedSender: boolean,
): Promise<{ text: string }> {
  const trimmed = args.trim();
  if (!trimmed || trimmed === "help" || trimmed === "hosted") {
    if (pluginConfig.online?.enabled && pluginConfig.online.apiUrl?.trim() && pluginConfig.online.apiToken?.trim()) {
      return textReply(
        [
          "ClawCollect already has online config:",
          `- apiUrl: ${pluginConfig.online.apiUrl}`,
          "- apiToken: configured",
          "",
          "Run /collect connect check to verify access, or /collect form open <title> to start collecting.",
          "",
          renderHostedConnectGuide(),
        ].join("\n"),
      );
    }
    return textReply(renderHostedConnectGuide());
  }

  if (!isAuthorizedSender) {
    return textReply("Only authorized senders can change ClawCollect connection settings.");
  }

  const parsedConfig = parseConnectConfigInput(trimmed);
  if (parsedConfig) {
    try {
      return textReply(await renderAutoConnectReply(parsedConfig));
    } catch (error) {
      return textReply(
        [
          "ClawCollect connect failed.",
          formatOnlineError(error),
          "",
          "Paste a fresh hosted config block or token into /collect connect and try again.",
        ].join("\n"),
      );
    }
  }

  const { head: action, tail } = splitFirstWord(trimmed);

  if (action === "hosted") {
    const parts = splitPipeArgs(tail);
    if (parts.length < 2) {
      return textReply(
        "Usage: /collect connect hosted <workspace name> | <owner email> | [owner name] | [signup code]",
      );
    }

    const [workspaceName, ownerEmail, ownerName, signupCode] = parts;
    try {
      const provisioned = await signupHostedWorkspace({
        workspaceName,
        ownerEmail,
        ownerName,
        signupCode,
      });
      return textReply(
        await renderAutoConnectReply(
          {
            apiUrl: provisioned.apiUrl,
            apiToken: provisioned.apiToken,
          },
          {
            workspaceName: provisioned.workspaceName,
            ownerEmail: provisioned.ownerEmail,
          },
        ),
      );
    } catch (error) {
      return textReply(
        [
          "Hosted signup failed.",
          formatOnlineError(error),
          "",
          `You can still open ${DEFAULT_HOSTED_SIGNUP_URL} in a browser, or retry /collect connect hosted ...`,
        ].join("\n"),
      );
    }
  }

  if (action === "token") {
    const token = tail.trim();
    if (!token) {
      return textReply("Usage: /collect connect token <cc_tok_...>");
    }
    return textReply(renderConnectCommandsReply(DEFAULT_HOSTED_API_URL, token));
  }

  if (action === "custom") {
    const { head: apiUrl, tail: tokenTail } = splitFirstWord(tail);
    const apiToken = tokenTail.trim();
    if (!apiUrl || !apiToken) {
      return textReply("Usage: /collect connect custom <apiUrl> <cc_tok_...>");
    }
    return textReply(renderConnectCommandsReply(apiUrl, apiToken));
  }

  if (action === "check") {
    const client = resolveOnlineClient(pluginConfig);
    if (typeof client === "string") {
      return textReply(
        [
          "ClawCollect is not connected yet.",
          client,
          "",
          renderHostedConnectGuide(),
        ].join("\n"),
      );
    }

    try {
      const page = await client.listForms();
      return textReply(
        [
          "ClawCollect connection is ready.",
          `- apiUrl: ${resolveOnlineBaseUrl(pluginConfig)}`,
          "- auth: ok",
          `- forms visible in this workspace: ${page.forms.length}`,
          "",
          "Next: /collect form open BBQ Friday",
        ].join("\n"),
      );
    } catch (err) {
      return textReply(
        [
          "ClawCollect connect check failed.",
          formatOnlineError(err),
          "",
          "If you just signed up for hosted access, paste the latest config block or token into /collect connect.",
        ].join("\n"),
      );
    }
  }

  return textReply(
    [
      "Unknown connect action.",
      "Try:",
      "/collect connect",
      "/collect connect hosted <workspace name> | <owner email> | [owner name] | [signup code]",
      "/collect connect token <cc_tok_...>",
      "/collect connect custom <apiUrl> <cc_tok_...>",
      "/collect connect check",
    ].join("\n"),
  );
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
        "/collect connect",
        "/collect connect hosted <workspace name> | <owner email> | [owner name] | [signup code]",
        "/collect connect token <cc_tok_...>",
        "/collect connect check",
        "",
        "/collect form open <title>",
        "/collect form status",
        "/collect form summary",
        "/collect form close",
        "",
        "Requires online config: online.enabled, online.apiUrl, online.apiToken",
        "Fastest hosted path: /collect connect",
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
