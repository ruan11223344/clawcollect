#!/usr/bin/env node

/**
 * Provision one hosted customer workspace plus one owner API token.
 *
 * Usage:
 *   node scripts/provision-workspace.mjs --name "Acme" --email ops@acme.com --remote
 *   node scripts/provision-workspace.mjs --name "Acme" --email ops@acme.com --plan pro --api-url https://collect.example.com --json
 */

import { randomBytes, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const GB = 1024 * 1024 * 1024;

const PLAN_DEFAULTS = {
  free: {
    plan: "free",
    active_forms_limit: 3,
    monthly_responses_limit: 100,
    total_forms_limit: 10,
    file_upload_enabled: 0,
    file_storage_limit_bytes: 0,
    export_enabled: 0,
    password_protection: 0,
    link_expiration: 0,
    custom_domain: 0,
    remove_branding: 0,
    scheduled_close: 0,
    webhook_notification: 0,
    audit_log: 0,
    team_seats_limit: 1,
  },
  pro: {
    plan: "pro",
    active_forms_limit: 20,
    monthly_responses_limit: 2000,
    total_forms_limit: 200,
    file_upload_enabled: 1,
    file_storage_limit_bytes: 1 * GB,
    export_enabled: 1,
    password_protection: 1,
    link_expiration: 1,
    custom_domain: 0,
    remove_branding: 1,
    scheduled_close: 1,
    webhook_notification: 0,
    audit_log: 0,
    team_seats_limit: 1,
  },
  team: {
    plan: "team",
    active_forms_limit: 100,
    monthly_responses_limit: 10000,
    total_forms_limit: 1000,
    file_upload_enabled: 1,
    file_storage_limit_bytes: 10 * GB,
    export_enabled: 1,
    password_protection: 1,
    link_expiration: 1,
    custom_domain: 1,
    remove_branding: 1,
    scheduled_close: 1,
    webhook_notification: 1,
    audit_log: 1,
    team_seats_limit: 5,
  },
};

function usage(exitCode = 0) {
  const text = `
Usage:
  npm run provision:workspace -- --name "Acme" --email ops@acme.com [options]

Required:
  --name, --workspace-name   Workspace display name
  --email                    Owner email for the hosted customer

Options:
  --user-name                Owner display name (default: same as workspace name)
  --plan                     free | pro | team (default: free)
  --api-url                  Include this hosted service URL in the output snippet
  --db                       D1 database name (default: from wrangler.toml)
  --remote                   Provision against remote D1 (default)
  --local                    Provision against local D1
  --json                     Print machine-readable JSON
  --help                     Show this help

Notes:
  - Each run creates a distinct workspace and a distinct API token.
  - The plaintext token is shown only once by this script.
  - For paid plans without Paddle sync yet, the script anchors usage to the current UTC month.
`;
  const output = exitCode === 0 ? console.log : console.error;
  output(text.trim());
  process.exit(exitCode);
}

function parseArgs(argv) {
  const options = {
    mode: "remote",
    plan: "free",
    json: false,
    apiUrl: null,
    name: null,
    email: null,
    userName: null,
    dbName: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        usage(0);
        break;
      case "--name":
      case "--workspace-name":
        options.name = argv[++i] ?? null;
        break;
      case "--email":
        options.email = argv[++i] ?? null;
        break;
      case "--user-name":
        options.userName = argv[++i] ?? null;
        break;
      case "--plan":
        options.plan = argv[++i] ?? null;
        break;
      case "--api-url":
        options.apiUrl = argv[++i] ?? null;
        break;
      case "--db":
        options.dbName = argv[++i] ?? null;
        break;
      case "--remote":
        options.mode = "remote";
        break;
      case "--local":
        options.mode = "local";
        break;
      case "--json":
        options.json = true;
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        usage(1);
    }
  }

  if (!options.name?.trim()) {
    console.error("Missing required --name");
    usage(1);
  }

  if (!options.email?.trim()) {
    console.error("Missing required --email");
    usage(1);
  }

  if (!Object.hasOwn(PLAN_DEFAULTS, options.plan)) {
    console.error(`Invalid --plan: ${options.plan}`);
    usage(1);
  }

  options.name = options.name.trim();
  options.email = options.email.trim().toLowerCase();
  options.userName = options.userName?.trim() || options.name;
  options.apiUrl = options.apiUrl?.trim() || null;
  return options;
}

function readDefaultDbName() {
  const wranglerPath = path.resolve("wrangler.toml");
  const content = readFileSync(wranglerPath, "utf8");
  const match = content.match(/database_name\s*=\s*"([^"]+)"/);
  if (!match) {
    throw new Error(`Could not find database_name in ${wranglerPath}`);
  }
  return match[1];
}

function nowEpoch() {
  return Math.floor(Date.now() / 1000);
}

function resolveBillingPeriodRange() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return {
    start: Math.floor(Date.UTC(year, month, 1) / 1000),
    end: Math.floor(Date.UTC(year, month + 1, 1) / 1000),
  };
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runWrangler(dbName, mode, sqlFile) {
  const args = ["wrangler", "d1", "execute", dbName, `--${mode}`, "--file", sqlFile];
  const result = spawnSync("npx", args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`wrangler d1 execute failed with exit code ${result.status ?? 1}`);
  }
}

function printHumanSummary(summary) {
  console.log("Provisioned hosted workspace:");
  console.log(`  workspace: ${summary.workspaceName}`);
  console.log(`  plan: ${summary.plan}`);
  console.log(`  owner email: ${summary.email}`);
  console.log(`  workspace_id: ${summary.workspaceId}`);
  console.log(`  user_id: ${summary.userId}`);
  console.log(`  token_id: ${summary.tokenId}`);
  console.log("");
  console.log("API token (shown once):");
  console.log(`  ${summary.token}`);
  console.log("");
  if (summary.apiUrl) {
    console.log("OpenClaw config:");
    console.log("{");
    console.log('  online: {');
    console.log('    enabled: true,');
    console.log(`    apiUrl: "${summary.apiUrl}",`);
    console.log(`    apiToken: "${summary.token}"`);
    console.log("  }");
    console.log("}");
    console.log("");
  }
  console.log("Notes:");
  console.log("  - This token is scoped to this workspace only.");
  console.log("  - Do not reuse one token across multiple hosted customers.");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const dbName = options.dbName || readDefaultDbName();
  const suffix = randomBytes(4).toString("hex");
  const now = nowEpoch();
  const userId = `usr_hosted_${suffix}`;
  const workspaceId = `ws_hosted_${suffix}`;
  const tokenId = `tok_hosted_${suffix}`;
  const token = `cc_tok_${randomBytes(32).toString("hex")}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const entitlements = PLAN_DEFAULTS[options.plan];
  const period = options.plan === "free"
    ? { startSql: "NULL", endSql: "NULL" }
    : (() => {
        const range = resolveBillingPeriodRange();
        return { startSql: String(range.start), endSql: String(range.end) };
      })();

  const sql = `
BEGIN TRANSACTION;

INSERT INTO users (id, email, name, created_at, last_login_at)
VALUES (${sqlString(userId)}, ${sqlString(options.email)}, ${sqlString(options.userName)}, ${now}, ${now});

INSERT INTO workspaces (id, name, owner_id, plan, created_at)
VALUES (${sqlString(workspaceId)}, ${sqlString(options.name)}, ${sqlString(userId)}, ${sqlString(options.plan)}, ${now});

INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
VALUES (${sqlString(workspaceId)}, ${sqlString(userId)}, 'owner', ${now});

INSERT INTO entitlements (
  workspace_id, plan, status,
  active_forms_limit, monthly_responses_limit, total_forms_limit,
  file_upload_enabled, file_storage_limit_bytes,
  export_enabled, password_protection, link_expiration,
  custom_domain, remove_branding, scheduled_close,
  webhook_notification, audit_log, team_seats_limit,
  current_period_start, current_period_end, updated_at
) VALUES (
  ${sqlString(workspaceId)}, ${sqlString(entitlements.plan)}, 'active',
  ${entitlements.active_forms_limit}, ${entitlements.monthly_responses_limit}, ${entitlements.total_forms_limit},
  ${entitlements.file_upload_enabled}, ${entitlements.file_storage_limit_bytes},
  ${entitlements.export_enabled}, ${entitlements.password_protection}, ${entitlements.link_expiration},
  ${entitlements.custom_domain}, ${entitlements.remove_branding}, ${entitlements.scheduled_close},
  ${entitlements.webhook_notification}, ${entitlements.audit_log}, ${entitlements.team_seats_limit},
  ${period.startSql}, ${period.endSql}, ${now}
);

INSERT INTO api_tokens (id, workspace_id, created_by, name, token_hash, created_at)
VALUES (${sqlString(tokenId)}, ${sqlString(workspaceId)}, ${sqlString(userId)}, 'Hosted workspace token', ${sqlString(tokenHash)}, ${now});

COMMIT;
`.trim();

  const sqlFile = path.join(tmpdir(), `clawcollect-provision-${suffix}.sql`);

  try {
    writeFileSync(sqlFile, `${sql}\n`, "utf8");
    runWrangler(dbName, options.mode, sqlFile);
  } finally {
    try {
      unlinkSync(sqlFile);
    } catch {
      // Ignore cleanup failure.
    }
  }

  const summary = {
    mode: options.mode,
    dbName,
    apiUrl: options.apiUrl,
    workspaceName: options.name,
    email: options.email,
    plan: options.plan,
    userId,
    workspaceId,
    tokenId,
    token,
  };

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  printHumanSummary(summary);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
