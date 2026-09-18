// The plans a shop can be on. A plain module, not the 'use server' actions file, because a server file may
// only export async functions.
export const PLANS = ['trial', 'starter', 'business', 'custom'] as const;
export type Plan = (typeof PLANS)[number];
