#!/usr/bin/env node

/**
 * ClawCollect Online Service — Smoke Test
 *
 * End-to-end test of the form collection main chain and key failure scenarios.
 *
 * Prerequisites:
 *   - Online service running locally: cd services/online && npm run dev
 *   - D1 migrations applied: npm run db:migrate:local
 *
 * Environment variables:
 *   SMOKE_BASE_URL     — Service URL (default: http://localhost:8787)
 *   SMOKE_API_TOKEN    — Pre-existing Bearer token (skips dev-header token creation)
 *   SMOKE_USER_ID      — Dev user ID for token creation (default: smoke-user)
 *   SMOKE_WORKSPACE_ID — Dev workspace ID for token creation (default: smoke-ws)
 *
 * Usage:
 *   node scripts/smoke.mjs
 *   SMOKE_API_TOKEN=cc_tok_xxxxx node scripts/smoke.mjs
 *   SMOKE_BASE_URL=https://staging.example.com SMOKE_API_TOKEN=cc_tok_xxxxx node scripts/smoke.mjs
 */

const BASE_URL = (process.env.SMOKE_BASE_URL || "http://localhost:8787").replace(/\/+$/, "");
const EXTERNAL_TOKEN = process.env.SMOKE_API_TOKEN || null;
const DEV_USER_ID = process.env.SMOKE_USER_ID || "smoke-user";
const DEV_WORKSPACE_ID = process.env.SMOKE_WORKSPACE_ID || "smoke-ws";

let passed = 0;
let failed = 0;
let apiToken = null;
let formId = null;
let linkToken = null;
let linkUrl = null;
let responseId1 = null;
let editToken1 = null;

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

function devHeaders() {
  return {
    "X-Dev-User-Id": DEV_USER_ID,
    "X-Dev-Workspace-Id": DEV_WORKSPACE_ID,
  };
}

function bearerHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

// ── Main chain ─────────────────────────────────────────────────────

async function testCreateToken() {
  if (EXTERNAL_TOKEN) {
    // Verify the supplied token works
    const { status } = await req("GET", "/api/forms", undefined, bearerHeaders(EXTERNAL_TOKEN));
    if (status === 200) {
      apiToken = EXTERNAL_TOKEN;
      log("PASS", "External API token verified");
    } else {
      log("FAIL", "External API token rejected", `status=${status}`);
    }
    return;
  }
  const { status, data } = await req("POST", "/api/tokens", { name: "smoke-test" }, devHeaders());
  if (status === 201 && data?.token?.startsWith("cc_tok_")) {
    apiToken = data.token;
    log("PASS", "Create API token", `id=${data.id}`);
  } else {
    log("FAIL", "Create API token", `status=${status} body=${JSON.stringify(data)}`);
  }
}

async function testCreateForm() {
  if (!apiToken) return log("FAIL", "Create form", "no token");
  const { status, data } = await req("POST", "/api/forms", {
    title: "Smoke Test Form",
    schema: [
      { id: "name", type: "text", label: "Name" },
      { id: "response", type: "textarea", label: "Response", required: true },
    ],
    settings: { allow_response_edit: true },
  }, bearerHeaders(apiToken));
  if (status === 201 && data?.id) {
    formId = data.id;
    log("PASS", "Create form", `id=${formId} status=${data.status}`);
  } else {
    log("FAIL", "Create form", `status=${status} body=${JSON.stringify(data)}`);
  }
}

async function testPublishForm() {
  if (!formId) return log("FAIL", "Publish form", "no form");
  const { status, data } = await req("POST", `/api/forms/${formId}/publish`, undefined, bearerHeaders(apiToken));
  if (status === 200 && data?.status === "active") {
    log("PASS", "Publish form");
  } else {
    log("FAIL", "Publish form", `status=${status} body=${JSON.stringify(data)}`);
  }
}

async function testCreateLink() {
  if (!formId) return log("FAIL", "Create link", "no form");
  const { status, data } = await req("POST", `/api/forms/${formId}/links`, {
    access_type: "private",
  }, bearerHeaders(apiToken));
  if (status === 201 && data?.token && data?.url) {
    linkToken = data.token;
    linkUrl = data.url;
    log("PASS", "Create link", `url=${linkUrl}`);
  } else {
    log("FAIL", "Create link", `status=${status} body=${JSON.stringify(data)}`);
  }
}

async function testPublicGetForm() {
  if (!linkToken) return log("FAIL", "Public GET form", "no link");
  const { status, data } = await req("GET", `/f/${linkToken}`);
  if (status === 200 && data?.form?.title === "Smoke Test Form") {
    log("PASS", "Public GET form", `title=${data.form.title}`);
  } else {
    log("FAIL", "Public GET form", `status=${status} body=${JSON.stringify(data)}`);
  }
}

async function testSubmitResponse1() {
  if (!linkToken) return log("FAIL", "Submit response 1", "no link");
  const { status, data } = await req("POST", `/f/${linkToken}/submit`, {
    data: { name: "Alice", response: "I'll bring drinks" },
  });
  if (status === 201 && data?.id) {
    responseId1 = data.id;
    editToken1 = data.edit_token || null;
    log("PASS", "Submit response 1", `id=${responseId1}`);
  } else {
    log("FAIL", "Submit response 1", `status=${status} body=${JSON.stringify(data)}`);
  }
}

async function testSubmitResponse2() {
  if (!linkToken) return log("FAIL", "Submit response 2", "no link");
  const { status, data } = await req("POST", `/f/${linkToken}/submit`, {
    data: { name: "Bob", response: "I'll bring chips" },
  });
  if (status === 201 && data?.id) {
    log("PASS", "Submit response 2", `id=${data.id}`);
  } else {
    log("FAIL", "Submit response 2", `status=${status} body=${JSON.stringify(data)}`);
  }
}

async function testGetForm() {
  if (!formId) return log("FAIL", "GET form (auth)", "no form");
  const { status, data } = await req("GET", `/api/forms/${formId}`, undefined, bearerHeaders(apiToken));
  if (status === 200 && data?.form?.responses_count >= 2) {
    log("PASS", "GET form (auth)", `responses_count=${data.form.responses_count}`);
  } else {
    log("FAIL", "GET form (auth)", `status=${status} responses_count=${data?.form?.responses_count}`);
  }
}

async function testGetResponses() {
  if (!formId) return log("FAIL", "GET responses", "no form");
  const { status, data } = await req("GET", `/api/forms/${formId}/responses?status=accepted`, undefined, bearerHeaders(apiToken));
  if (status === 200 && data?.total >= 2 && data?.responses?.length >= 2) {
    log("PASS", "GET responses", `total=${data.total}`);
  } else {
    log("FAIL", "GET responses", `status=${status} total=${data?.total}`);
  }
}

async function testCloseForm() {
  if (!formId) return log("FAIL", "Close form", "no form");
  const { status, data } = await req("POST", `/api/forms/${formId}/close`, undefined, bearerHeaders(apiToken));
  if (status === 200 && data?.status === "closed") {
    log("PASS", "Close form");
  } else {
    log("FAIL", "Close form", `status=${status} body=${JSON.stringify(data)}`);
  }
}

async function testSubmitAfterClose() {
  if (!linkToken) return log("FAIL", "Submit after close", "no link");
  const { status } = await req("POST", `/f/${linkToken}/submit`, {
    data: { name: "Late", response: "Too late" },
  });
  if (status === 404) {
    log("PASS", "Submit after close rejected", `status=${status}`);
  } else {
    log("FAIL", "Submit after close rejected", `expected 404, got ${status}`);
  }
}

// ── Failure scenarios ──────────────────────────────────────────────

async function testInvalidBearerToken() {
  const { status, data } = await req("GET", "/api/forms", undefined, bearerHeaders("cc_tok_invalid_garbage"));
  if (status === 401) {
    log("PASS", "Invalid bearer token", `error=${data?.error}`);
  } else {
    log("FAIL", "Invalid bearer token", `expected 401, got ${status}`);
  }
}

async function testNoBearerToken() {
  const { status } = await req("GET", "/api/forms");
  if (status === 401) {
    log("PASS", "No bearer token");
  } else {
    log("FAIL", "No bearer token", `expected 401, got ${status}`);
  }
}

async function testFormNotFound() {
  if (!apiToken) return log("FAIL", "Form not found", "no token");
  const { status } = await req("GET", "/api/forms/frm_nonexistent", undefined, bearerHeaders(apiToken));
  if (status === 404) {
    log("PASS", "Form not found");
  } else {
    log("FAIL", "Form not found", `expected 404, got ${status}`);
  }
}

async function testPublicInvalidLink() {
  const { status } = await req("GET", "/f/totally_fake_token");
  if (status === 404) {
    log("PASS", "Public invalid link");
  } else {
    log("FAIL", "Public invalid link", `expected 404, got ${status}`);
  }
}

// ── Validation on active form (create a second form for this) ──────

async function testValidationOnActiveForm() {
  if (!apiToken) return log("FAIL", "Validation on active form", "no token");

  // Create + publish + link a temporary form
  const { data: f } = await req("POST", "/api/forms", {
    title: "Validation Test",
    schema: [{ id: "answer", type: "textarea", label: "Answer", required: true }],
  }, bearerHeaders(apiToken));
  if (!f?.id) return log("FAIL", "Validation on active form", "could not create form");

  await req("POST", `/api/forms/${f.id}/publish`, undefined, bearerHeaders(apiToken));

  const { data: lnk } = await req("POST", `/api/forms/${f.id}/links`, { access_type: "private" }, bearerHeaders(apiToken));
  if (!lnk?.token) return log("FAIL", "Validation on active form", "could not create link");

  // Submit without the required field
  const { status, data } = await req("POST", `/f/${lnk.token}/submit`, {
    data: { something_else: "hello" },
  });
  if (status === 400 && data?.error === "validation_failed") {
    log("PASS", "Validation on active form", `field_errors=${JSON.stringify(data.field_errors)}`);
  } else {
    log("FAIL", "Validation on active form", `status=${status} body=${JSON.stringify(data)}`);
  }

  // Clean up: close the temp form
  await req("POST", `/api/forms/${f.id}/close`, undefined, bearerHeaders(apiToken));
}

// ── Runner ─────────────────────────────────────────────────────────

async function main() {
  console.log(`\nClawCollect Online Service Smoke Test`);
  console.log(`Base URL: ${BASE_URL}`);
  if (EXTERNAL_TOKEN) {
    console.log(`Auth: external token (SMOKE_API_TOKEN)\n`);
  } else {
    console.log(`Auth: dev headers (user=${DEV_USER_ID} workspace=${DEV_WORKSPACE_ID})\n`);
  }
  console.log("── Main chain ──────────────────────────────");

  await testCreateToken();
  await testCreateForm();
  await testPublishForm();
  await testCreateLink();
  await testPublicGetForm();
  await testSubmitResponse1();
  await testSubmitResponse2();
  await testGetForm();
  await testGetResponses();
  await testCloseForm();
  await testSubmitAfterClose();

  console.log("\n── Failure scenarios ────────────────────────");

  await testInvalidBearerToken();
  await testNoBearerToken();
  await testFormNotFound();
  await testPublicInvalidLink();
  await testValidationOnActiveForm();

  console.log(`\n── Summary ─────────────────────────────────`);
  console.log(`Passed: ${passed}  Failed: ${failed}  Total: ${passed + failed}`);

  if (failed > 0) {
    console.log("\n\x1b[31mSMOKE TEST FAILED\x1b[0m");
    process.exit(1);
  } else {
    console.log("\n\x1b[32mALL SMOKE TESTS PASSED\x1b[0m");
  }
}

main().catch((err) => {
  console.error("\nSmoke test crashed:", err.message || err);
  process.exit(2);
});
