// The answers a Bangladeshi customer asks for before anything else: what delivery costs, how long it takes,
// what happens if they want to return something. The agent is forbidden from guessing any of it, so until a
// merchant fills these in it can only say "the shop will confirm" — the most visible weakness the AI has.
// One JSONB column on tenants (migration 011), so a new policy needs no migration: add it to POLICY_FIELDS.

export type ShopPolicies = Partial<Record<PolicyKey, string>>;

export const POLICY_FIELDS = [
  {
    key: 'deliveryInsideDhaka',
    label: 'Delivery charge inside Dhaka',
    placeholder: '60 taka',
    hint: 'Leave blank if you have not decided. The AI will say you confirm it by phone.',
  },
  { key: 'deliveryOutsideDhaka', label: 'Delivery charge outside Dhaka', placeholder: '120 taka' },
  { key: 'deliveryTime', label: 'How long delivery takes', placeholder: '1-2 days inside Dhaka, 3-4 days outside' },
  { key: 'payment', label: 'Payment you accept', placeholder: 'Cash on delivery only' },
  { key: 'returns', label: 'Returns and exchanges', placeholder: 'Exchange within 3 days if the item is unused, with the delivery slip' },
  { key: 'hours', label: 'When someone answers', placeholder: 'Saturday to Thursday, 10am to 8pm' },
  { key: 'extra', label: 'Anything else the AI should be able to say', placeholder: 'We gift wrap free of charge. No delivery to Saint Martin.', textarea: true },
] as const;

export type PolicyKey = (typeof POLICY_FIELDS)[number]['key'];

const MAX_LENGTH = 500;

export function readPolicies(value: unknown): ShopPolicies {
  const source = (value ?? {}) as Record<string, unknown>;
  const policies: ShopPolicies = {};
  for (const field of POLICY_FIELDS) {
    const text = typeof source[field.key] === 'string' ? (source[field.key] as string).trim().slice(0, MAX_LENGTH) : '';
    if (text) policies[field.key] = text;
  }
  return policies;
}

// Only the filled-in policies reach the prompt: a blank one must leave the agent saying "the shop will
// confirm" rather than inventing an answer.
export const policyPrompt = (policies: ShopPolicies) =>
  POLICY_FIELDS.filter((f) => policies[f.key])
    .map((f) => `- ${f.label}: ${policies[f.key]}`)
    .join('\n');

// The two or three promises worth showing above the first message. A customer arriving from a Facebook link
// decides in seconds whether this shop is real; these are the answers they would otherwise have to ask for.
// Short, because they sit in one row on a phone — the full list is one tap away.
const CHIP_ORDER: { key: PolicyKey; prefix?: string }[] = [
  { key: 'payment' },
  { key: 'deliveryInsideDhaka', prefix: 'Dhaka' },
  { key: 'returns' },
  { key: 'deliveryTime' },
];
const CHIP_MAX = 3;
const CHIP_CHARS = 30;

export function policyChips(policies: ShopPolicies): { key: PolicyKey; text: string }[] {
  return CHIP_ORDER.flatMap(({ key, prefix }) => {
    const value = policies[key];
    if (!value) return [];
    const text = prefix ? `${prefix} ${value}` : value;
    return [{ key, text: text.length > CHIP_CHARS ? `${text.slice(0, CHIP_CHARS - 1).trimEnd()}…` : text }];
  }).slice(0, CHIP_MAX);
}
