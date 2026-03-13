#!/usr/bin/env node

/**
 * ClawCollect Online Service — Role & Isolation Smoke Test
 *
 * Tests multi-workspace isolation and role-based access control.
 *
 * Prerequisites:
 *   - Online service running locally: cd services/online && npm run dev
 *   - D1 migrations applied: npm run db:migrate:local
 *
 * Environment variables:
 *   SMOKE_BASE_URL — Service URL (default: http://localhost:8787)
 *
 * Usage:
 *   node scripts/smoke-roles.mjs
 *
 * Limitation:
 *   Dev headers always provision role=owner. There is no API to create
 *   member-role users, so member-specific restrictions (e.g. member
 *   cannot create tokens, member cannot moderate) are NOT tested here.
 *   Testing member restrictions requires direct DB seeding or a future
 *   team management API.
 */

const BASE_URL = (process.env.SMOKE_BASE_URL || "http://localhost:8787").replace(/\/+$/, "");

// Two isolated workspaces
const WS_A = { userId: "role-smoke-owner-a", workspaceId: "role-smoke-ws-a" };
const WS_B = { userId: "role-smoke-owner-b", workspaceId: "role-smoke-ws-b" };

let passed = 0;
let failed = 0;

// State shared across tests
let tokenA = null;
let tokenB = null;
let formIdA = null;
let linkTokenA = null;
let responseIdA = null;

function log(status, name, detail) {
  const icon = status === "PASS" ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  const msg = detail ? `${icon} ${name} — ${detail}` : `${icon} ${name}`;
  console.log(msg);
  if (status === "PASS") passed++;
  else failed++;
}

async function req(method, path, body, headers = {}) {
  const url = `${BASE_URL}${path}`;
  const opts = { method, headers: { Accept: "application/json", ...headers } };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

function devHeaders(ws) {
  return { "X-Dev-User-Id": ws.userId, "X-Dev-Workspace-Id": ws.workspaceId };
}

function bearerHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

// ── Owner permissions (workspace A) ──────────────────────────────

async function testOwnerCreateToken() {
  const { status, data } = await req("POST", "/api/tokens", { name: "ws-a-token" }, devHeaders(WS_A));
  if (status === 201 && data?.token?.startsWith("cc_tok_")) {
    tokenA = data.token;
    log("PASS", "Owner A creates token", `id=${data.id}`);
  } else {
    log("FAIL", "Owner A creates token", `status=${status}`);
  }
}

async function testOwnerBCreateToken() {
  const { status, data } = await req("POST", "/api/tokens", { name: "ws-b-token" }, devHeaders(WS_B));
  if (status === 201 && data?.token?.startsWith("cc_tok_")) {
    tokenB = data.token;
    log("PASS", "Owner B creates token", `id=${data.id}`);
  } else {
    log("FAIL", "Owner B creates token", `status=${status}`);
  }
}

async function testOwnerCreateForm() {
  if (!tokenA) return log("FAIL", "Owner A creates form", "no token");
  const { status, data } = await req("POST", "/api/forms", {
    title: "Role Test Form",
    schema: [{ id: "answer", type: "textarea", label: "Answer", required: true }],
  }, bearerHeaders(tokenA));
  if (status === 201 && data?.id) {
    formIdA = data.id;
    log("PASS", "Owner A creates form", `id=${formIdA}`);
  } else {
    log("FAIL", "Owner A creates form", `status=${status}`);
  }
}

async function testOwnerPublishForm() {
  if (!formIdA) return log("FAIL", "Owner A publishes form", "no form");
  const { status, data } = await req("POST", `/api/forms/${formIdA}/publish`, undefined, bearerHeaders(tokenA));
  if (status === 200 && data?.status === "active") {
    log("PASS", "Owner A publishes form");
  } else {
    log("FAIL", "Owner A publishes form", `status=${status}`);
  }
}

async function testOwnerCreateLink() {
  if (!formIdA) return log("FAIL", "Owner A creates link", "no form");
  const { status, data } = await req("POST", `/api/forms/${formIdA}/links`, { access_type: "private" }, bearerHeaders(tokenA));
  if (status === 201 && data?.token) {
    linkTokenA = data.token;
    log("PASS", "Owner A creates link");
  } else {
    log("FAIL", "Owner A creates link", `status=${status}`);
  }
}

async function testPublicSubmit() {
  if (!linkTokenA) return log("FAIL", "Public submit (no auth)", "no link");
  const { status, data } = await req("POST", `/f/${linkTokenA}/submit`, {
    data: { answer: "Public response" },
  });
  if (status === 201 && data?.id) {
    responseIdA = data.id;
    log("PASS", "Public submit (no auth)", `id=${responseIdA}`);
  } else {
    log("FAIL", "Public submit (no auth)", `status=${status}`);
  }
}

async function testOwnerModerate() {
  if (!formIdA || !responseIdA) return log("FAIL", "Owner A moderates", "missing form/response");
  const { status, data } = await req(
    "PATCH",
    `/api/forms/${formIdA}/responses/${responseIdA}/moderation`,
    { status: "spam" },
    bearerHeaders(tokenA),
  );
  if (status === 200 && data?.status === "spam") {
    log("PASS", "Owner A moderates response → spam");
  } else {
    log("FAIL", "Owner A moderates response", `status=${status}`);
  }
}

async function testOwnerRestoreModeration() {
  if (!formIdA || !responseIdA) return log("FAIL", "Owner A restores moderation", "missing form/response");
  const { status, data } = await req(
    "PATCH",
    `/api/forms/${formIdA}/responses/${responseIdA}/moderation`,
    { status: "accepted" },
    bearerHeaders(tokenA),
  );
  if (status === 200 && data?.status === "accepted") {
    log("PASS", "Owner A restores moderation → accepted");
  } else {
    log("FAIL", "Owner A restores moderation", `status=${status}`);
  }
}

async function testOwnerListTokens() {
  if (!tokenA) return log("FAIL", "Owner A lists tokens", "no token");
  const { status, data } = await req("GET", "/api/tokens", undefined, bearerHeaders(tokenA));
  if (status === 200 && Array.isArray(data?.tokens) && data.tokens.length >= 1) {
    log("PASS", "Owner A lists tokens", `count=${data.tokens.length}`);
  } else {
    log("FAIL", "Owner A lists tokens", `status=${status}`);
  }
}

// ── Cross-workspace isolation ────────────────────────────────────

async function testCrossWsFormListEmpty() {
  if (!tokenB) return log("FAIL", "Cross-ws: B lists A forms", "no token B");
  const { status, data } = await req("GET", "/api/forms", undefined, bearerHeaders(tokenB));
  // B should see no forms (or only B's own forms, not A's)
  const hasAForm = (data?.forms ?? []).some((f) => f.id === formIdA);
  if (status === 200 && !hasAForm) {
    log("PASS", "Cross-ws: B cannot list A's forms");
  } else {
    log("FAIL", "Cross-ws: B cannot list A's forms", `found formIdA in list`);
  }
}

async function testCrossWsFormGetById() {
  if (!tokenB || !formIdA) return log("FAIL", "Cross-ws: B gets A form by ID", "missing data");
  const { status } = await req("GET", `/api/forms/${formIdA}`, undefined, bearerHeaders(tokenB));
  if (status === 404) {
    log("PASS", "Cross-ws: B GET A's form → 404");
  } else {
    log("FAIL", "Cross-ws: B GET A's form", `expected 404, got ${status}`);
  }
}

async function testCrossWsModerate() {
  if (!tokenB || !formIdA || !responseIdA) return log("FAIL", "Cross-ws: B moderates A's response", "missing data");
  const { status } = await req(
    "PATCH",
    `/api/forms/${formIdA}/responses/${responseIdA}/moderation`,
    { status: "spam" },
    bearerHeaders(tokenB),
  );
  if (status === 404) {
    log("PASS", "Cross-ws: B moderate A's response → 404");
  } else {
    log("FAIL", "Cross-ws: B moderate A's response", `expected 404, got ${status}`);
  }
}

async function testCrossWsGetResponses() {
  if (!tokenB || !formIdA) return log("FAIL", "Cross-ws: B reads A's responses", "missing data");
  const { status } = await req("GET", `/api/forms/${formIdA}/responses`, undefined, bearerHeaders(tokenB));
  if (status === 404) {
    log("PASS", "Cross-ws: B read A's responses → 404");
  } else {
    log("FAIL", "Cross-ws: B read A's responses", `expected 404, got ${status}`);
  }
}

async function testCrossWsCloseForm() {
  if (!tokenB || !formIdA) return log("FAIL", "Cross-ws: B closes A's form", "missing data");
  const { status } = await req("POST", `/api/forms/${formIdA}/close`, undefined, bearerHeaders(tokenB));
  if (status === 404) {
    log("PASS", "Cross-ws: B close A's form → 404");
  } else {
    log("FAIL", "Cross-ws: B close A's form", `expected 404, got ${status}`);
  }
}

async function testCrossWsCreateLinkOnAForm() {
  if (!tokenB || !formIdA) return log("FAIL", "Cross-ws: B creates link on A's form", "missing data");
  const { status } = await req("POST", `/api/forms/${formIdA}/links`, { access_type: "private" }, bearerHeaders(tokenB));
  if (status === 404) {
    log("PASS", "Cross-ws: B create link on A's form → 404");
  } else {
    log("FAIL", "Cross-ws: B create link on A's form", `expected 404, got ${status}`);
  }
}

// ── Public respondent boundaries ─────────────────────────────────

async function testPublicCannotAccessApi() {
  const { status } = await req("GET", "/api/forms");
  if (status === 401) {
    log("PASS", "Public: /api/forms without auth → 401");
  } else {
    log("FAIL", "Public: /api/forms without auth", `expected 401, got ${status}`);
  }
}

async function testPublicCannotModerate() {
  if (!formIdA || !responseIdA) return log("FAIL", "Public: moderate without auth", "missing data");
  const { status } = await req(
    "PATCH",
    `/api/forms/${formIdA}/responses/${responseIdA}/moderation`,
    { status: "spam" },
  );
  if (status === 401) {
    log("PASS", "Public: moderate without auth → 401");
  } else {
    log("FAIL", "Public: moderate without auth", `expected 401, got ${status}`);
  }
}

async function testPublicCannotCreateToken() {
  const { status } = await req("POST", "/api/tokens", { name: "hacker" });
  if (status === 401) {
    log("PASS", "Public: create token without auth → 401");
  } else {
    log("FAIL", "Public: create token without auth", `expected 401, got ${status}`);
  }
}

// ── Cleanup ──────────────────────────────────────────────────────

async function cleanup() {
  if (formIdA && tokenA) {
    await req("POST", `/api/forms/${formIdA}/close`, undefined, bearerHeaders(tokenA));
  }
}

// ── Runner ───────────────────────────────────────────────────────

async function main() {
  console.log(`\nClawCollect Role & Isolation Smoke Test`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Workspace A: ${WS_A.workspaceId} (owner: ${WS_A.userId})`);
  console.log(`Workspace B: ${WS_B.workspaceId} (owner: ${WS_B.userId})\n`);

  console.log("── Owner permissions (workspace A) ─────────");

  await testOwnerCreateToken();
  await testOwnerBCreateToken();
  await testOwnerCreateForm();
  await testOwnerPublishForm();
  await testOwnerCreateLink();
  await testPublicSubmit();
  await testOwnerModerate();
  await testOwnerRestoreModeration();
  await testOwnerListTokens();

  console.log("\n── Cross-workspace isolation ────────────────");

  await testCrossWsFormListEmpty();
  await testCrossWsFormGetById();
  await testCrossWsModerate();
  await testCrossWsGetResponses();
  await testCrossWsCloseForm();
  await testCrossWsCreateLinkOnAForm();

  console.log("\n── Public respondent boundaries ─────────────");

  await testPublicCannotAccessApi();
  await testPublicCannotModerate();
  await testPublicCannotCreateToken();

  await cleanup();

  console.log(`\n── Summary ─────────────────────────────────`);
  console.log(`Passed: ${passed}  Failed: ${failed}  Total: ${passed + failed}`);

  if (failed > 0) {
    console.log("\n\x1b[31mROLE SMOKE TEST FAILED\x1b[0m");
    process.exit(1);
  } else {
    console.log("\n\x1b[32mALL ROLE SMOKE TESTS PASSED\x1b[0m");
  }
}

main().catch((err) => {
  console.error("\nRole smoke test crashed:", err.message || err);
  process.exit(2);
});
