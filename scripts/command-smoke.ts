import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ClawCollectPluginConfig } from "../src/types.js";
import { invokeCollectCommand } from "./command-harness-lib.js";

type SmokeCase = {
  name: string;
  commandBody: string;
  pluginConfig?: ClawCollectPluginConfig;
  expect: string[];
  skip?: string;
};

function hasEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

async function main(): Promise<void> {
  process.env.CLAWCOLLECT_SKIP_OPENCLAW_CONFIG_WRITE = "1";

  const stateDir = path.join(os.tmpdir(), "clawcollect-command-smoke");
  await fs.rm(stateDir, { recursive: true, force: true });

  const liveApiUrl = hasEnv("CLAWCOLLECT_SMOKE_API_URL");
  const liveApiToken = hasEnv("CLAWCOLLECT_SMOKE_API_TOKEN");

  const cases: SmokeCase[] = [
    {
      name: "help",
      commandBody: "/collect help",
      expect: ["/collect connect hosted <workspace name> | <owner email>", "/collect form open <title>"],
    },
    {
      name: "connect guide",
      commandBody: "/collect connect",
      expect: ["ClawCollect hosted setup:", "/collect connect hosted <workspace name> | <owner email>"],
    },
    {
      name: "form help",
      commandBody: "/collect form help",
      expect: ["Form collection commands:", "Fastest hosted path: /collect connect"],
    },
    {
      name: "connect check",
      commandBody: "/collect connect check",
      pluginConfig:
        liveApiUrl && liveApiToken
          ? {
              online: {
                enabled: true,
                apiUrl: liveApiUrl,
                apiToken: liveApiToken,
              },
            }
          : undefined,
      expect: liveApiUrl && liveApiToken
        ? ["ClawCollect connection is ready.", "- auth: ok"]
        : [],
      skip: liveApiUrl && liveApiToken
        ? undefined
        : "Set CLAWCOLLECT_SMOKE_API_URL and CLAWCOLLECT_SMOKE_API_TOKEN to run the live connectivity check.",
    },
  ];

  let pass = 0;
  let fail = 0;
  let skip = 0;

  for (const testCase of cases) {
    if (testCase.skip) {
      console.log(`SKIP ${testCase.name}: ${testCase.skip}`);
      skip += 1;
      continue;
    }

    try {
      const result = await invokeCollectCommand({
        commandBody: testCase.commandBody,
        pluginConfig: testCase.pluginConfig,
        stateDir,
        authorized: true,
      });
      const missing = testCase.expect.filter(
        (needle) => !result.reply.text.includes(needle),
      );

      if (missing.length > 0) {
        console.log(`FAIL ${testCase.name}: missing ${missing.join(", ")}`);
        fail += 1;
        continue;
      }

      console.log(`PASS ${testCase.name}`);
      pass += 1;
    } catch (error) {
      console.log(
        `FAIL ${testCase.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
      fail += 1;
    }
  }

  console.log(`\n${pass} PASS / ${fail} FAIL / ${skip} SKIP`);
  if (fail > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
