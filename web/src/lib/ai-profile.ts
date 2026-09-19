// How a shop's AI speaks and what extra rules it follows, on top of the catalog and the shop policies.
// Persona is the platform admin's (migration 015); the playbook is the merchant's. Both are read through these
// functions on the way in and on the way out, so only known fields, trimmed and length-capped, ever reach a prompt.

export type AiPersona = { assistantName?: string; tone?: string; adminInstructions?: string };
export type PlaybookRule = { when: string; then: string };

export const PLAYBOOK_MAX_RULES = 30;
const WHEN_MAX = 300;
const THEN_MAX = 1000;

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export function readPersona(value: unknown): AiPersona {
  const source = (value ?? {}) as Record<string, unknown>;
  const persona: AiPersona = {};
  const assistantName = text(source.assistantName, 60);
  const tone = text(source.tone, 1000);
  const adminInstructions = text(source.adminInstructions, 3000);
  if (assistantName) persona.assistantName = assistantName;
  if (tone) persona.tone = tone;
  if (adminInstructions) persona.adminInstructions = adminInstructions;
  return persona;
}

// A rule missing either half is dropped: a trigger with no action, or an action with no trigger, is noise.
export function readPlaybook(value: unknown): PlaybookRule[] {
  return (Array.isArray(value) ? value : [])
    .map((r) => ({ when: text(r?.when, WHEN_MAX), then: text(r?.then, THEN_MAX) }))
    .filter((r) => r.when && r.then)
    .slice(0, PLAYBOOK_MAX_RULES);
}

export const playbookPrompt = (rules: PlaybookRule[]) => rules.map((r, i) => `${i + 1}. When ${r.when} -> ${r.then}`).join('\n');
