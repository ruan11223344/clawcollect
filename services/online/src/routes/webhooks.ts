import { Hono } from "hono";
import type { Env } from "../env";
import { updateEntitlements } from "../db/entitlements";
import { nowEpoch } from "../lib/time";
import type { PlanId } from "../lib/plans";

const webhooks = new Hono<{ Bindings: Env }>();

/**
 * Paddle webhook receiver.
 *
 * Handles subscription lifecycle events and syncs entitlements to D1.
 * Security: Validates Paddle-Signature header via HMAC-SHA256.
 * Idempotency: Deduplicates by event_id in webhook_events table.
 * Error handling: Returns 5xx on processing failure so Paddle retries.
 */
webhooks.post("/paddle", async (c) => {
  const db = c.env.DB;
  const rawBody = await c.req.text();

  // ── Signature verification ────────────────────────────────────────
  const signature = c.req.header("Paddle-Signature");
  if (!signature) {
    return c.json({ error: "Missing Paddle-Signature header" }, 401);
  }

  const secret = c.env.PADDLE_WEBHOOK_SECRET;
  if (secret) {
    const valid = await verifyPaddleSignature(rawBody, signature, secret);
    if (!valid) {
      return c.json({ error: "Invalid signature" }, 401);
    }
  } else {
    // In development without a secret, log a warning but continue
    console.warn("[webhook] PADDLE_WEBHOOK_SECRET not set — skipping signature verification");
  }

  // ── Parse payload ─────────────────────────────────────────────────
  let payload: PaddleWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const eventId = payload.event_id;
  const eventType = payload.event_type;

  if (!eventId || !eventType) {
    return c.json({ error: "Missing event_id or event_type" }, 400);
  }

  // ── Idempotency check ────────────────────────────────────────────
  const existing = await db
    .prepare("SELECT id, processed FROM webhook_events WHERE id = ?")
    .bind(eventId)
    .first<{ id: string; processed: number }>();

  if (existing) {
    if (existing.processed) {
      // Already successfully processed — return 200
      return c.json({ ok: true, deduplicated: true });
    }
    // Previously stored but failed — allow retry below
  }

  // Store the event (if not already stored from a previous failed attempt)
  if (!existing) {
    const now = nowEpoch();
    await db
      .prepare(
        `INSERT INTO webhook_events (id, event_type, payload, processed, created_at)
         VALUES (?, ?, ?, 0, ?)`,
      )
      .bind(eventId, eventType, rawBody, now)
      .run();
  }

  // ── Process event ─────────────────────────────────────────────────
  try {
    await processWebhookEvent(db, c.env, payload);

    // Mark as processed
    await db
      .prepare("UPDATE webhook_events SET processed = 1, processed_at = ? WHERE id = ?")
      .bind(nowEpoch(), eventId)
      .run();

    return c.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[webhook] Failed to process ${eventType}: ${message}`);
    // Return 500 so Paddle retries
    return c.json({ error: "Processing failed", detail: message }, 500);
  }
});

// ── Types ───────────────────────────────────────────────────────────

interface PaddleWebhookPayload {
  event_id: string;
  event_type: string;
  data: {
    id?: string; // subscription_id
    status?: string;
    custom_data?: {
      workspace_id?: string;
    };
    items?: Array<{
      price?: {
        product_id?: string;
      };
      quantity?: number;
    }>;
    current_billing_period?: {
      starts_at?: string;
      ends_at?: string;
    };
    scheduled_change?: unknown;
    customer_id?: string;
  };
}

// ── Plan mapping ────────────────────────────────────────────────────

/**
 * Resolve Paddle product_id to a ClawCollect plan.
 * Uses PADDLE_PRODUCT_PRO and PADDLE_PRODUCT_TEAM env vars.
 * Throws if the product_id is not recognized — this prevents silent upgrades.
 */
function resolvePlan(env: Env, data: PaddleWebhookPayload["data"]): PlanId {
  const productId = data.items?.[0]?.price?.product_id;
  if (!productId) {
    throw new Error("Webhook payload missing items[0].price.product_id — cannot determine plan");
  }

  if (env.PADDLE_PRODUCT_PRO && productId === env.PADDLE_PRODUCT_PRO) {
    return "pro";
  }
  if (env.PADDLE_PRODUCT_TEAM && productId === env.PADDLE_PRODUCT_TEAM) {
    return "team";
  }

  throw new Error(
    `Unrecognized Paddle product_id "${productId}". ` +
    `Configure PADDLE_PRODUCT_PRO and/or PADDLE_PRODUCT_TEAM env vars.`,
  );
}

// ── Event processing ────────────────────────────────────────────────

async function processWebhookEvent(
  db: D1Database,
  env: Env,
  payload: PaddleWebhookPayload,
): Promise<void> {
  const { event_type, data } = payload;

  switch (event_type) {
    case "subscription.created":
    case "subscription.updated":
    case "subscription.activated":
    case "subscription.resumed":
      await handleSubscriptionChange(db, env, data);
      break;

    case "subscription.canceled":
      await handleSubscriptionStatusChange(db, env, data, "canceled");
      break;

    case "subscription.paused":
      await handleSubscriptionStatusChange(db, env, data, "paused");
      break;

    case "transaction.completed":
      // Payment confirmed — subscription.updated usually covers entitlement changes
      console.log(`[webhook] transaction.completed for subscription ${data.id}`);
      break;

    case "transaction.payment_failed":
      await handleSubscriptionStatusChange(db, env, data, "past_due");
      break;

    default:
      console.log(`[webhook] Unhandled event type: ${event_type}`);
  }
}

async function handleSubscriptionChange(
  db: D1Database,
  env: Env,
  data: PaddleWebhookPayload["data"],
): Promise<void> {
  const workspaceId = data.custom_data?.workspace_id;
  if (!workspaceId) {
    throw new Error("subscription event missing workspace_id in custom_data");
  }

  const plan = resolvePlan(env, data);
  const status = data.status ?? "active";
  const periodStart = parsePeriodStart(data);
  const periodEnd = parsePeriodEnd(data);

  await updateEntitlements(db, workspaceId, plan, status, periodStart, periodEnd);
  await upsertSubscriptionMirror(db, workspaceId, data, plan, status);
}

/**
 * Handle cancel / pause / payment_failed.
 * Preserves current_period_end — don't clear it, the user retains access until period ends.
 */
async function handleSubscriptionStatusChange(
  db: D1Database,
  env: Env,
  data: PaddleWebhookPayload["data"],
  newStatus: string,
): Promise<void> {
  const workspaceId = data.custom_data?.workspace_id;
  if (!workspaceId) {
    throw new Error(`${newStatus} event missing workspace_id in custom_data`);
  }

  const plan = resolvePlan(env, data);

  // Preserve existing period boundaries rather than clearing them.
  // Paddle still sends current_billing_period on cancel/pause.
  const periodStart = parsePeriodStart(data);
  const periodEnd = parsePeriodEnd(data);

  await updateEntitlements(db, workspaceId, plan, newStatus, periodStart, periodEnd);
  await upsertSubscriptionMirror(db, workspaceId, data, plan, newStatus);
}

function parsePeriodStart(data: PaddleWebhookPayload["data"]): number | null {
  if (data.current_billing_period?.starts_at) {
    return Math.floor(new Date(data.current_billing_period.starts_at).getTime() / 1000);
  }
  return null;
}

function parsePeriodEnd(data: PaddleWebhookPayload["data"]): number | null {
  if (data.current_billing_period?.ends_at) {
    return Math.floor(new Date(data.current_billing_period.ends_at).getTime() / 1000);
  }
  return null;
}

async function upsertSubscriptionMirror(
  db: D1Database,
  workspaceId: string,
  data: PaddleWebhookPayload["data"],
  plan: PlanId,
  status: string,
): Promise<void> {
  const now = nowEpoch();
  const paddleSubId = data.id ?? "";

  const periodStart = data.current_billing_period?.starts_at
    ? Math.floor(new Date(data.current_billing_period.starts_at).getTime() / 1000)
    : null;
  const periodEnd = parsePeriodEnd(data);

  await db
    .prepare(
      `INSERT INTO subscriptions (id, workspace_id, paddle_subscription_id, paddle_customer_id, status, plan, billing_cycle, quantity, current_period_start, current_period_end, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, 'monthly', ?, ?, ?, ?)
       ON CONFLICT(paddle_subscription_id) DO UPDATE SET
         status = excluded.status,
         plan = excluded.plan,
         quantity = excluded.quantity,
         current_period_start = excluded.current_period_start,
         current_period_end = excluded.current_period_end,
         synced_at = excluded.synced_at`,
    )
    .bind(
      `sub_${paddleSubId.slice(0, 12)}`,
      workspaceId,
      paddleSubId,
      data.customer_id ?? null,
      status,
      plan,
      data.items?.[0]?.quantity ?? 1,
      periodStart,
      periodEnd,
      now,
    )
    .run();
}

// ── Signature verification ──────────────────────────────────────────

/**
 * Verify Paddle webhook signature.
 *
 * Paddle uses H1 signature scheme: ts=<timestamp>;h1=<hex-encoded HMAC-SHA256>
 * The signed payload is: timestamp + ":" + rawBody
 *
 * Reference: https://developer.paddle.com/webhooks/signature-verification
 */
async function verifyPaddleSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  const parts = signatureHeader.split(";");
  let ts = "";
  let h1 = "";
  for (const part of parts) {
    const [key, value] = part.split("=", 2);
    if (key === "ts") ts = value;
    if (key === "h1") h1 = value;
  }

  if (!ts || !h1) return false;

  // Check timestamp is within 5 minutes to prevent replay
  const now = Math.floor(Date.now() / 1000);
  const eventTs = parseInt(ts, 10);
  if (Math.abs(now - eventTs) > 300) return false;

  // Compute HMAC-SHA256
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signedPayload = `${ts}:${rawBody}`;
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time comparison
  if (expected.length !== h1.length) return false;
  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ h1.charCodeAt(i);
  }
  return result === 0;
}

export { webhooks };
