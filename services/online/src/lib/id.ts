/**
 * Generate prefixed IDs using crypto.randomUUID().
 * Format: <prefix>_<12-char hex>
 */
export function generateId(prefix: string): string {
  const uuid = crypto.randomUUID().replace(/-/g, "");
  return `${prefix}_${uuid.slice(0, 12)}`;
}

/**
 * Generate a high-entropy token for form links.
 * 32 bytes = 64 hex chars — not enumerable.
 */
export function generateLinkToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
