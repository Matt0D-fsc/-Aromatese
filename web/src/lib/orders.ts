import type { ShopPolicies } from '@/lib/policies';

// What the AI and the shop's staff both need when they write an order.

export const BD_MOBILE = /^(?:\+?88)?01[3-9]\d{8}$/;

export const newOrderNumber = () => `CN-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

// orders.total_bdt is the items (the shop's sale); orders.courier_fee_bdt is the delivery charge on top.
// What the courier collects in cash is both.
export const collectAmount = (o: { total_bdt: number | string; courier_fee_bdt?: number | string | null }) =>
  Number(o.total_bdt) + Number(o.courier_fee_bdt ?? 0);

export type DeliveryArea = 'inside_dhaka' | 'outside_dhaka';

const BANGLA_DIGITS = '০১২৩৪৫৬৭৮৯';

// The delivery charge a merchant wrote in their policies, as a number, or null when it is not one clear amount.
// "60 taka", "৳120", "১২০ টাকা" and "Free" read as 60, 120, 120 and 0. "60-80", "free over 2000, else 60" and
// "depends on weight" read as null, and null means the AI keeps saying the shop confirms it by phone: a wrong
// charge on an order is worse than no charge.
// ponytail: one number or nothing; a delivery-rules table when shops need weight or area tiers.
export function parseFee(text: string | undefined): number | null {
  if (!text) return null;
  const normal = text
    .replace(/[০-৯]/g, (d) => String(BANGLA_DIGITS.indexOf(d)))
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .toLowerCase();
  const numbers = normal.match(/\d+(?:\.\d+)?/g) ?? [];
  if (numbers.length === 1) return Number(numbers[0]);
  if (numbers.length === 0 && /free|ফ্রি|ফ্রী/.test(normal)) return 0;
  return null;
}

export function deliveryFees(policies: ShopPolicies): Record<DeliveryArea, number | null> {
  return { inside_dhaka: parseFee(policies.deliveryInsideDhaka), outside_dhaka: parseFee(policies.deliveryOutsideDhaka) };
}
