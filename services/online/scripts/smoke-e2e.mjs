#!/usr/bin/env node

/**
 * ClawCollect Online Service — Browser E2E Smoke Test
 *
 * Tests the public form browser flow: open page → see fields → fill → submit → success.
 * Uses Playwright if available.
 *
 * Prerequisites:
 *   - Online service running locally: cd services/online && npm run dev
 *   - D1 migrations applied: npm run db:migrate:local
 *   - Playwright installed: npx playwright install chromium
 *
 * Environment variables:
 *   SMOKE_BASE_URL — Service URL (default: http://localhost:8787)
 *
 * Usage:
 *   node scripts/smoke-e2e.mjs
 *
 * The public form endpoint (GET /f/:token) returns HTML by default.
 * API clients send Accept: application/json (or ?format=json) to get JSON.
 */

const BASE_URL = (process.env.SMOKE_BASE_URL || "http://localhost:8787").replace(/\/+$/, "");
const DEV_USER_ID = "e2e-smoke-user";
const DEV_WORKSPACE_ID = "e2e-smoke-ws";

let passed = 0;
let failed = 0;
let skipped = 0;

function log(status, name, detail) {
  if (status === "SKIP") {
    const msg = detail ? `\x1b[33mSKIP\x1b[0m ${name} — ${detail}` : `\x1b[33mSKIP\x1b[0m ${name}`;
    console.log(msg);
    skipped++;
    return;
  }
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
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

function devHeaders() {
  return { "X-Dev-User-Id": DEV_USER_ID, "X-Dev-Workspace-Id": DEV_WORKSPACE_ID };
}

function bearerHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

// ── API bootstrap: create form + publish + link ──────────────────

async function bootstrapForm() {
  console.log("── API bootstrap ───────────────────────────");

  // Create token
  const { data: tokData } = await req("POST", "/api/tokens", { name: "e2e-test" }, devHeaders());
  if (!tokData?.token) {
    log("FAIL", "Bootstrap: create token");
    return null;
  }
  log("PASS", "Bootstrap: create token");
  const apiToken = tokData.token;

  // Create form
  const { data: formData } = await req("POST", "/api/forms", {
    title: "E2E Browser Test",
    schema: [
      { id: "name", type: "text", label: "Your Name" },
      { id: "response", type: "textarea", label: "Your Response", required: true },
    ],
    settings: { allow_response_edit: true },
  }, bearerHeaders(apiToken));
  if (!formData?.id) {
    log("FAIL", "Bootstrap: create form");
    return null;
  }
  log("PASS", "Bootstrap: create form", `id=${formData.id}`);

  // Publish
  const { data: pubData } = await req("POST", `/api/forms/${formData.id}/publish`, undefined, bearerHeaders(apiToken));
  if (pubData?.status !== "active") {
    log("FAIL", "Bootstrap: publish form");
    return null;
  }
  log("PASS", "Bootstrap: publish form");

  // Create link
  const { data: linkData } = await req("POST", `/api/forms/${formData.id}/links`, { access_type: "private" }, bearerHeaders(apiToken));
  if (!linkData?.token) {
    log("FAIL", "Bootstrap: create link");
    return null;
  }
  log("PASS", "Bootstrap: create link", `url=${linkData.url}`);

  const { data: resultsData } = await req("POST", `/api/forms/${formData.id}/results-link`, undefined, bearerHeaders(apiToken));
  if (!resultsData?.url) {
    log("FAIL", "Bootstrap: create results link");
    return null;
  }
  log("PASS", "Bootstrap: create results link", `url=${resultsData.url}`);

  return {
    apiToken,
    formId: formData.id,
    linkToken: linkData.token,
    linkUrl: `${BASE_URL}/f/${linkData.token}`,
    resultsUrl: `${BASE_URL}${resultsData.url}`,
  };
}

// ── Browser tests ────────────────────────────────────────────────

async function runBrowserTests(ctx) {
  let chromium;
  try {
    const pw = await import("playwright");
    chromium = pw.chromium;
  } catch {
    console.log("\n── Browser tests ───────────────────────────");
    log("SKIP", "Browser tests", "playwright not installed — run: npx playwright install chromium");

    // Still verify API-level behavior
    console.log("\n── API-level verification (fallback) ───────");
    const { status, data } = await req("GET", `/f/${ctx.linkToken}`);
    if (status === 200 && data?.form?.title === "E2E Browser Test") {
      log("PASS", "Public form JSON API returns correct data");
    } else {
      log("FAIL", "Public form JSON API", `status=${status}`);
    }

    const { status: subStatus, data: subData } = await req("POST", `/f/${ctx.linkToken}/submit`, {
      data: { name: "E2E User", response: "Browser test response" },
    });
    if (subStatus === 201 && subData?.id && subData?.edit_token) {
      log("PASS", "Public form submit via API works", `id=${subData.id}`);
    } else {
      log("FAIL", "Public form submit via API", `status=${subStatus}`);
    }

    if (subData?.id && subData?.edit_token) {
      const { status: editStatus, data: editData } = await req("PUT", `/f/${ctx.linkToken}/responses/${subData.id}`, {
        edit_token: subData.edit_token,
        data: { name: "E2E User", response: "Edited via API fallback" },
      });
      if (editStatus === 200 && editData?.edited === true) {
        log("PASS", "Public response edit via API works", `id=${subData.id}`);
      } else {
        log("FAIL", "Public response edit via API", `status=${editStatus}`);
      }
    }

    const resultsRes = await fetch(ctx.resultsUrl);
    const resultsHtml = await resultsRes.text();
    if (resultsRes.status === 200 && /Edited via API fallback/i.test(resultsHtml)) {
      log("PASS", "Collector results page shows submitted data");
    } else {
      log("FAIL", "Collector results page", `status=${resultsRes.status}`);
    }

    // Close form and verify rejection
    await req("POST", `/api/forms/${ctx.formId}/close`, undefined, bearerHeaders(ctx.apiToken));
    const { status: closedStatus } = await req("POST", `/f/${ctx.linkToken}/submit`, {
      data: { name: "Late", response: "Too late" },
    });
    if (closedStatus === 404) {
      log("PASS", "Closed form rejects submit", `status=${closedStatus}`);
    } else {
      log("FAIL", "Closed form rejects submit", `expected 404, got ${closedStatus}`);
    }

    const closedResultsRes = await fetch(ctx.resultsUrl);
    const closedResultsHtml = await closedResultsRes.text();
    if (closedResultsRes.status === 200 && /Form status: closed/i.test(closedResultsHtml)) {
      log("PASS", "Collector results page remains available after close");
    } else {
      log("FAIL", "Collector results after close", `status=${closedResultsRes.status}`);
    }
    return;
  }

  console.log("\n── Browser tests (active form) ─────────────");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // Navigate to public form
    await page.goto(ctx.linkUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
    const content = await page.content();

    const hasFormUI = content.includes("<form") || content.includes("<input") || content.includes("<textarea");
    if (hasFormUI) {
      log("PASS", "Form page has HTML UI");
    } else {
      log("FAIL", "Form page has HTML UI", "no <form>/<input>/<textarea> found");
    }

    // Check title visible
    const titleVisible = await page.locator("text=E2E Browser Test").isVisible().catch(() => false);
    if (titleVisible) {
      log("PASS", "Form title visible");
    } else {
      log("FAIL", "Form title visible");
    }

    // Check field labels
    const nameLabel = await page.locator("text=Your Name").isVisible().catch(() => false);
    const responseLabel = await page.locator("text=Your Response").isVisible().catch(() => false);
    if (nameLabel && responseLabel) {
      log("PASS", "Field labels visible");
    } else {
      log("FAIL", "Field labels visible", `name=${nameLabel} response=${responseLabel}`);
    }

    // Fill and submit
    try {
      const nameInput = page.locator('input[name="name"]').first();
      await nameInput.fill("E2E Browser User");
      log("PASS", "Fill name field");
    } catch (e) {
      log("FAIL", "Fill name field", e.message);
    }

    try {
      const responseInput = page.locator('textarea[name="response"]').first();
      await responseInput.fill("Submitted from Playwright");
      log("PASS", "Fill response field");
    } catch (e) {
      log("FAIL", "Fill response field", e.message);
    }

    try {
      const submitBtn = page.locator('button[type="submit"]').first();
      await submitBtn.click();
      await page.waitForSelector('#cc-success', { state: "visible", timeout: 5000 }).catch(() => null);
      const pageText = await page.textContent("body");
      const summaryVisible = /submitted response/i.test(pageText || "")
        && /E2E Browser User/i.test(pageText || "")
        && /Submitted from Playwright/i.test(pageText || "");
      if (summaryVisible) {
        log("PASS", "Confirmation summary visible after submit");
      } else {
        log("FAIL", "Confirmation summary visible after submit", "submitted values not visible");
      }

      const editButtonVisible = await page.locator('#cc-edit-btn').isVisible().catch(() => false);
      if (editButtonVisible) {
        log("PASS", "Edit response action visible");
      } else {
        log("FAIL", "Edit response action visible");
      }

      await page.locator('#cc-edit-btn').click();
      await page.locator('textarea[name="response"]').fill("Edited from Playwright");
      await submitBtn.click();
      await page.waitForSelector('#cc-success', { state: "visible", timeout: 5000 }).catch(() => null);

      const updatedText = await page.textContent("body");
      if (/updated/i.test(updatedText || "") && /Edited from Playwright/i.test(updatedText || "")) {
        log("PASS", "In-page response edit works");
      } else {
        log("FAIL", "In-page response edit works", "updated summary not visible");
      }

      await page.goto(ctx.resultsUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
      const resultsText = await page.textContent("body");
      if (/Collector Results/i.test(resultsText || "") && /Edited from Playwright/i.test(resultsText || "")) {
        log("PASS", "Collector results page shows latest response");
      } else {
        log("FAIL", "Collector results page shows latest response", "submitted data not visible");
      }
    } catch (e) {
      log("FAIL", "Submit form", e.message);
    }
  } catch (e) {
    log("FAIL", "Browser navigation", e.message);
  }

  // ── Closed form test ──────────────────────────────────────────
  console.log("\n── Browser tests (closed form) ─────────────");

  // Close the form via API
  await req("POST", `/api/forms/${ctx.formId}/close`, undefined, bearerHeaders(ctx.apiToken));

  try {
    await page.goto(ctx.linkUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
    const publicBodyText = await page.textContent("body");

    const publicClosedIndicator = /closed|unavailable|not found|not currently accepting/i.test(publicBodyText || "");
    if (publicClosedIndicator) {
      log("PASS", "Closed form shows unavailable state");
    } else {
      log("FAIL", "Closed form state", "no closed/unavailable indicator found");
    }

    await page.goto(ctx.resultsUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
    const bodyText = await page.textContent("body");

    const hasClosedIndicator = /Form status: closed/i.test(bodyText || "");
    if (hasClosedIndicator) {
      log("PASS", "Closed collector results page remains available");
    } else {
      log("FAIL", "Closed collector results page", "no closed indicator found");
    }
  } catch (e) {
    log("FAIL", "Closed collector results navigation", e.message);
  }

  await browser.close();
}

// ── Runner ───────────────────────────────────────────────────────

async function main() {
  console.log(`\nClawCollect Browser E2E Smoke Test`);
  console.log(`Base URL: ${BASE_URL}\n`);

  const ctx = await bootstrapForm();
  if (!ctx) {
    console.log("\n\x1b[31mBOOTSTRAP FAILED — cannot run browser tests\x1b[0m");
    process.exit(1);
  }

  await runBrowserTests(ctx);

  console.log(`\n── Summary ─────────────────────────────────`);
  console.log(`Passed: ${passed}  Failed: ${failed}  Skipped: ${skipped}  Total: ${passed + failed + skipped}`);

  if (failed > 0) {
    console.log("\n\x1b[31mE2E SMOKE TEST FAILED\x1b[0m");
    process.exit(1);
  } else if (skipped > 0) {
    console.log("\n\x1b[33mE2E SMOKE TEST PASSED (some tests skipped)\x1b[0m");
  } else {
    console.log("\n\x1b[32mALL E2E SMOKE TESTS PASSED\x1b[0m");
  }
}

main().catch((err) => {
  console.error("\nE2E smoke test crashed:", err.message || err);
  process.exit(2);
});
