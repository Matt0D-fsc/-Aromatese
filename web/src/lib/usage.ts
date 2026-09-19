// A shop's monthly allowance of AI replies (tenants.monthly_message_limit, set in the admin panel; customer
// messages and staff replies do not count, see migration 017). When it runs out
// the AI stops replying until the month turns, so the merchant must see it coming, and must know when it has
// happened. One definition, used by the chat route, the merchant dashboard and the admin panel alike.

export const WARN_AT = 0.8;

export type UsageLevel = 'ok' | 'warn' | 'out';

export function usageLevel(used: number, limit: number): UsageLevel {
  if (used >= limit) return 'out';
  return used >= limit * WARN_AT ? 'warn' : 'ok';
}

// Months are UTC, matching tenant_usage_month (date_trunc in the database) and the chat route's own count.
export function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function nextReset(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}
