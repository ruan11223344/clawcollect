/**
 * Cloudflare Workers environment bindings.
 */
export interface Env {
  DB: D1Database;
  // FILES: R2Bucket;  // TODO: uncomment when file upload is implemented
  ENVIRONMENT: string;
  PADDLE_WEBHOOK_SECRET?: string;

  /**
   * Comma-separated list of allowed CORS origins for /api/* routes.
   * Example: "https://app.clawcollect.com,http://localhost:5173"
   * Falls back to same-origin only if not set in production.
   */
  ALLOWED_ORIGINS?: string;

  /**
   * Paddle product IDs mapped to plans.
   * These must match the product IDs created in Paddle dashboard.
   * If a webhook payload contains an unrecognized product_id, processing is rejected.
   */
  PADDLE_PRODUCT_PRO?: string;
  PADDLE_PRODUCT_TEAM?: string;
}
