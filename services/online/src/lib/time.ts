/** Current unix epoch in seconds. */
export function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Billing period boundaries.
 *
 * For paid workspaces: uses real `periodStart` and `periodEnd` from Paddle.
 * For free workspaces (both null): anchored to calendar months in UTC.
 *   - period_start = first second of the current UTC month
 *   - period_end   = first second of the next UTC month
 *
 * This is deterministic: any call within the same calendar month yields
 * the same (start, end) pair regardless of the exact second.
 */
export function resolveBillingPeriod(
  periodStart: number | null,
  periodEnd: number | null,
): { start: number; end: number } {
  if (periodStart !== null && periodEnd !== null) {
    return { start: periodStart, end: periodEnd };
  }

  // Free workspace: calendar month in UTC
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start = Math.floor(Date.UTC(year, month, 1) / 1000);
  const end = Math.floor(Date.UTC(year, month + 1, 1) / 1000);
  return { start, end };
}
