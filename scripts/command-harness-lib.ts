import fs from "node:fs/promises";
import path from "node:path";

import type {
  OpenClawConfig,
  OpenClawPluginApi,
} from "openclaw/plugin-sdk";

import { registerClawCollectCommands } from "../src/commands.js";
import type {
  ClawCollectPluginConfig,
  LifeCommandContext,
} from "../src/types.js";

type HarnessCommandHandler = (ctx: LifeCommandContext) => Promise<{ text: string }> | { text: string };
type HarnessCommandDefinition = {
  name: string;
  handler: HarnessCommandHandler;
};

export interface CollectHarnessOptions {
  commandBody: string;
  pluginConfig?: ClawCollectPluginConfig;
  stateDir: string;
  authorized?: boolean;
}

export interface CollectHarnessResult {
  reply: { text: string };
  commandBody: string;
  args: string;
  stateDir: string;
  authorized: boolean;
}

function buildNoopLogger() {
  return {
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => buildNoopLogger(),
  };
}

function unsupported(name: string): never {
  throw new Error(`Harness API method should not be used: ${name}`);
}

function normalizeCommandBody(input: string): { commandBody: string; args: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { commandBody: "/collect", args: "" };
  }

  if (trimmed === "/collect") {
    return { commandBody: trimmed, args: "" };
  }

  if (trimmed.startsWith("/collect ")) {
    return {
      commandBody: trimmed,
      args: trimmed.slice("/collect".length).trimStart(),
    };
  }

  if (trimmed.startsWith("/")) {
    return {
      commandBody: trimmed,
      args: trimmed,
    };
  }

  return {
    commandBody: `/collect ${trimmed}`,
    args: trimmed,
  };
}

async function buildApi(
  stateDir: string,
  pluginConfig: ClawCollectPluginConfig,
): Promise<{ api: OpenClawPluginApi; getHandler: () => HarnessCommandHandler }> {
  await fs.mkdir(stateDir, { recursive: true });

  let commandHandler: HarnessCommandHandler | null = null;
  const logger = buildNoopLogger();

  const api = {
    id: "clawcollect",
    name: "ClawCollect Harness",
    version: "0.0.0-harness",
    description: "Local harness for ClawCollect plugin commands.",
    source: "local-harness",
    config: {} as OpenClawConfig,
    pluginConfig,
    runtime: {
      state: {
        resolveStateDir: () => stateDir,
      },
    },
    logger,
    registerCommand: (command: HarnessCommandDefinition) => {
      if (command.name === "collect") {
        commandHandler = command.handler;
      }
    },
    registerTool: () => unsupported("registerTool"),
    registerHook: () => unsupported("registerHook"),
    registerHttpRoute: () => unsupported("registerHttpRoute"),
    registerChannel: () => unsupported("registerChannel"),
    registerGatewayMethod: () => unsupported("registerGatewayMethod"),
    registerCli: () => unsupported("registerCli"),
    registerService: () => unsupported("registerService"),
    registerProvider: () => unsupported("registerProvider"),
    registerContextEngine: () => unsupported("registerContextEngine"),
    resolvePath: (input: string) => path.resolve(input),
    on: () => unsupported("on"),
  } as unknown as OpenClawPluginApi;

  return {
    api,
    getHandler: () => {
      if (!commandHandler) {
        throw new Error("ClawCollect command handler was not registered");
      }
      return commandHandler;
    },
  };
}

export async function invokeCollectCommand(
  options: CollectHarnessOptions,
): Promise<CollectHarnessResult> {
  const pluginConfig = options.pluginConfig ?? {};
  const { commandBody, args } = normalizeCommandBody(options.commandBody);
  const authorized = options.authorized !== false;
  const { api, getHandler } = await buildApi(options.stateDir, pluginConfig);

  registerClawCollectCommands(api, pluginConfig);
  const handler = getHandler();

  const ctx: LifeCommandContext = {
    senderId: authorized ? "usr_harness" : "usr_guest",
    channel: "local-harness",
    channelId: "local-harness:cli",
    isAuthorizedSender: authorized,
    args,
    commandBody,
    from: authorized ? "usr_harness" : "usr_guest",
    to: "local-harness:cli",
    accountId: "local-harness",
    messageThreadId: 1,
  };

  const reply = await handler(ctx);
  return {
    reply,
    commandBody,
    args,
    stateDir: options.stateDir,
    authorized,
  };
}
