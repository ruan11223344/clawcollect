import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ClawCollectPluginConfig } from "../src/types.js";
import { invokeCollectCommand } from "./command-harness-lib.js";

interface HarnessCliOptions {
  commandBody: string;
  pluginConfig: ClawCollectPluginConfig;
  stateDir: string;
  authorized: boolean;
  json: boolean;
  liveConfigWrite: boolean;
  allowHostedProvisioning: boolean;
}

function usage(): string {
  return [
    "Usage: npm run command:harness -- [options] -- '/collect ...'",
    "",
    "Options:",
    "  --config-json <json>          Inline plugin config JSON",
    "  --config-file <path>          Read plugin config JSON from file",
    "  --state-dir <path>            Override harness state dir",
    "  --unauthorized                Simulate an unauthorized sender",
    "  --json                        Output harness result as JSON",
    "  --live-config-write           Allow /collect connect* to mutate OpenClaw config",
    "  --allow-hosted-provisioning   Allow /collect connect hosted ... to create a real hosted workspace",
    "  --help                        Show this help",
    "",
    "Examples:",
    "  npm run command:harness -- '/collect help'",
    "  npm run command:harness -- --config-json '{\"online\":{\"enabled\":true,\"apiUrl\":\"https://collect.dorapush.com\",\"apiToken\":\"cc_tok_xxx\"}}' '/collect connect check'",
    "  npm run command:harness -- --allow-hosted-provisioning --live-config-write '/collect connect hosted Acme Events | ops@acme.com'",
  ].join("\n");
}

function isHostedProvisionCommand(commandBody: string): boolean {
  const normalized = commandBody.trim().replace(/\s+/g, " ");
  return normalized.startsWith("/collect connect hosted ");
}

async function readConfigFile(filePath: string): Promise<ClawCollectPluginConfig> {
  const raw = await fs.readFile(path.resolve(filePath), "utf8");
  return JSON.parse(raw) as ClawCollectPluginConfig;
}

async function parseArgs(argv: string[]): Promise<HarnessCliOptions> {
  let pluginConfig: ClawCollectPluginConfig = {};
  let stateDir = path.join(os.tmpdir(), "clawcollect-command-harness");
  let authorized = true;
  let json = false;
  let liveConfigWrite = false;
  let allowHostedProvisioning = false;
  let commandParts: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--config-json") {
      pluginConfig = JSON.parse(argv[++i] ?? "{}") as ClawCollectPluginConfig;
      continue;
    }
    if (arg === "--config-file") {
      pluginConfig = await readConfigFile(argv[++i] ?? "");
      continue;
    }
    if (arg === "--state-dir") {
      stateDir = path.resolve(argv[++i] ?? stateDir);
      continue;
    }
    if (arg === "--unauthorized") {
      authorized = false;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--live-config-write") {
      liveConfigWrite = true;
      continue;
    }
    if (arg === "--allow-hosted-provisioning") {
      allowHostedProvisioning = true;
      continue;
    }
    if (arg === "--") {
      commandParts = argv.slice(i + 1);
      break;
    }
    commandParts.push(arg);
  }

  const commandBody = commandParts.join(" ").trim();
  if (!commandBody) {
    throw new Error(usage());
  }

  if (isHostedProvisionCommand(commandBody) && !allowHostedProvisioning) {
    throw new Error(
      "Refusing to run /collect connect hosted without --allow-hosted-provisioning.",
    );
  }

  return {
    commandBody,
    pluginConfig,
    stateDir,
    authorized,
    json,
    liveConfigWrite,
    allowHostedProvisioning,
  };
}

async function main(): Promise<void> {
  const options = await parseArgs(process.argv.slice(2));

  if (!options.liveConfigWrite) {
    process.env.CLAWCOLLECT_SKIP_OPENCLAW_CONFIG_WRITE = "1";
  } else {
    delete process.env.CLAWCOLLECT_SKIP_OPENCLAW_CONFIG_WRITE;
  }

  const result = await invokeCollectCommand({
    commandBody: options.commandBody,
    pluginConfig: options.pluginConfig,
    stateDir: options.stateDir,
    authorized: options.authorized,
  });

  if (options.json) {
    console.log(JSON.stringify({
      commandBody: result.commandBody,
      args: result.args,
      stateDir: result.stateDir,
      authorized: result.authorized,
      liveConfigWrite: options.liveConfigWrite,
      allowHostedProvisioning: options.allowHostedProvisioning,
      reply: result.reply,
    }, null, 2));
    return;
  }

  console.log(result.reply.text);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
