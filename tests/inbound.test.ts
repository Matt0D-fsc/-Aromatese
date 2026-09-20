import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb, opsOn, written, type FakeDb, type Handler, type Op } from './fake-supabase.js';

// What happens to a customer's message between arriving and being answered — the part the web chat route and
// the Meta webhook both hand off to. Everything here is a decision about whether the AI may speak at all:
// a person has the chat, the shop paused the AI, the month's allowance is gone, someone is flooding, or Meta
// delivered the same message twice. Each one wrong is either a silent shop or a bill the merchant never
// agreed to.

const runAgent = vi.fn();
const storeMedia = vi.fn(async (..._args: unknown[]) => undefined);
let db: FakeDb;

vi.mock('@/lib/agent', () => ({ runAgent: (...args: unknown[]) => runAgent(...args) }));
vi.mock('@/lib/media', () => ({ storeMedia: (...args: unknown[]) => storeMedia(...args) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }));

const { handleInbound, InboundError } = await import('../web/src/lib/inbound.js');

const TENANT = {
  id: 'a3f1c0de-0000-4000-8000-000000000001',
  name: 'Rupali Boutique',
  business_category: 'sarees',
  status: 'active',
  ai_enabled: true,
  monthly_message_limit: 1000,
  policies: {},
  ai_playbook: null,
};

const CONVERSATION: { id: string; ai_muted: boolean; taken_over_at: string | null; last_staff_reply_at: string | null } = {
  id: 'd0000000-0000-4000-8000-00000000000d',
  ai_muted: false,
  taken_over_at: null,
  last_staff_reply_at: null,
};
const MINUTES = 60_000;

const isCount = (op: Op) => (op.args[1] as { head?: boolean } | undefined)?.head === true;

type Setup = { conversation?: Partial<typeof CONVERSATION>; aiReplies?: number; customerMessages?: number; insert?: Handler; tenant?: Partial<typeof TENANT> };

function inbound(setup: Setup = {}, overrides: Record<string, unknown> = {}) {
  const conversation = { ...CONVERSATION, ...setup.conversation };
  // aiReply re-reads ai_muted after the agent returns, to catch staff taking over mid-thought. The flag has
  // to reflect writes for that check to mean anything, so this one column is kept honest.
  let muted = conversation.ai_muted;
  db = fakeDb({
    customers: { data: { id: 'c0000000-0000-4000-8000-00000000000c' } },
    conversations: (op) => {
      const patch = op.args[0] as { ai_muted?: boolean } | undefined;
      if (op.method === 'update' && typeof patch?.ai_muted === 'boolean') muted = patch.ai_muted;
      return { data: { ...conversation, ai_muted: muted } };
    },
    audit_logs: { count: 1 }, // the usage warning was already recorded this month
    tenant_ai_persona: { data: null },
    messages: (op) => {
      if (op.method === 'insert') {
        const row = op.args[0] as { sender_type: string };
        if (row.sender_type === 'bot') return { data: { id: 'm-bot', sender_type: 'bot', content_type: 'text', content_text: 'reply', media_url: null, grounding_data: {}, created_at: '2026-09-20T10:00:00Z' } };
        return typeof setup.insert === 'function' ? setup.insert(op) : (setup.insert ?? { data: { id: 'm-in' } });
      }
      if (isCount(op)) {
        // The monthly allowance counts the AI's replies; the flood limits count the customer's messages.
        const bot = op.filters.some((f) => f[0] === 'eq' && f[1] === 'sender_type' && f[2] === 'bot');
        return { count: bot ? (setup.aiReplies ?? 0) : (setup.customerMessages ?? 0) };
      }
      return { data: [] }; // recent history
    },
  });

  runAgent.mockResolvedValue({ text: 'Amader kache Silk Saree ache.', products: [{ id: 'p1', title: 'Silk Saree' }], orderNumber: null, toolCalls: [{ name: 'search_products', args: {} }], promptTokens: 100, outputTokens: 20 });

  return handleInbound(db as never, {
    tenant: { ...TENANT, ...setup.tenant },
    channel: 'web',
    channelUserId: 'visitor-1',
    text: 'Silk saree dekhao',
    ...overrides,
  } as Parameters<typeof handleInbound>[1]);
}

beforeEach(() => {
  runAgent.mockReset();
  storeMedia.mockReset();
});

describe('a normal message', () => {
  it('saves what the customer said, answers it, and keeps the grounding with the reply', async () => {
    const result = await inbound();

    expect(runAgent).toHaveBeenCalledOnce();
    expect(result.staff).toBe(false);
    expect(result.reply?.text).toBe('reply');

    const inserts = opsOn(db, 'messages').filter((op) => op.method === 'insert');
    expect(inserts[0].args[0]).toMatchObject({ sender_type: 'customer', content_text: 'Silk saree dekhao', content_type: 'text' });
    // The products the agent showed are stored with the reply: the inbox and the next turn both read them back.
    expect(inserts[1].args[0]).toMatchObject({
      sender_type: 'bot',
      content_text: 'Amader kache Silk Saree ache.',
      prompt_tokens: 100,
      output_tokens: 20,
      grounding_data: { products: [{ id: 'p1', title: 'Silk Saree' }], tools: [{ name: 'search_products', args: {} }] },
    });
  });

  it('files the customer and the conversation under the channel they came from', async () => {
    await inbound({}, { channel: 'messenger', channelUserId: 'psid-abc' });

    expect(written(db, 'customers')).toMatchObject({ tenant_id: TENANT.id, channel: 'messenger', channel_user_id: 'psid-abc' });
    expect(written(db, 'conversations')).toMatchObject({ channel: 'messenger' });
  });

  it('stores a photo alongside the reply rather than after it', async () => {
    const media = { mimeType: 'image/jpeg', kind: 'image' as const, bytes: Buffer.from('photo') };
    const result = await inbound({}, { media, text: '' });

    expect(storeMedia).toHaveBeenCalledOnce();
    expect(result.reply).not.toBeNull();
    // The agent is given the image itself, not just a note about it.
    expect(runAgent.mock.calls[0][0]).toMatchObject({ media: { mimeType: 'image/jpeg', kind: 'image' } });
  });
});

describe('when a person has the chat', () => {
  it('stays quiet while staff are active', async () => {
    const result = await inbound({ conversation: { ai_muted: true, last_staff_reply_at: new Date(Date.now() - 2 * MINUTES).toISOString() } });

    expect(runAgent).not.toHaveBeenCalled();
    expect(result).toMatchObject({ staff: true, reply: null });
  });

  it('takes the chat back when staff went quiet half an hour ago', async () => {
    const result = await inbound({ conversation: { ai_muted: true, last_staff_reply_at: new Date(Date.now() - 45 * MINUTES).toISOString() } });

    expect(runAgent).toHaveBeenCalledOnce();
    expect(result.reply).not.toBeNull();
    expect(opsOn(db, 'conversations').find((op) => op.method === 'update')?.args[0]).toMatchObject({ ai_muted: false });
  });

  it('throws its own reply away if staff took over while it was thinking', async () => {
    // Unmuted when the message arrived, muted by the time the agent finished.
    let seen = 0;
    db = fakeDb({
      customers: { data: { id: 'c1' } },
      conversations: () => ({ data: { ...CONVERSATION, ai_muted: seen++ > 0 } }),
      audit_logs: { count: 1 },
      tenant_ai_persona: { data: null },
      messages: (op) => (op.method === 'insert' ? { data: { id: 'm-in' } } : isCount(op) ? { count: 0 } : { data: [] }),
    });
    runAgent.mockResolvedValue({ text: 'talking over a person', products: [], orderNumber: null, toolCalls: [], promptTokens: 0, outputTokens: 0 });

    const result = await handleInbound(db as never, { tenant: TENANT, channel: 'web', channelUserId: 'v1', text: 'hi' } as Parameters<typeof handleInbound>[1]);

    expect(result).toMatchObject({ staff: true, reply: null });
    expect(opsOn(db, 'messages').filter((op) => op.method === 'insert' && (op.args[0] as { sender_type: string }).sender_type === 'bot')).toHaveLength(0);
  });
});

describe('when the AI must not answer', () => {
  it('flags the chat for a person when the shop has paused the AI', async () => {
    const result = await inbound({ tenant: { ai_enabled: false } });

    expect(runAgent).not.toHaveBeenCalled();
    expect(result).toMatchObject({ staff: false, reply: null });
    expect(opsOn(db, 'conversations').find((op) => op.method === 'update')?.args[0]).toMatchObject({ needs_human: true, handoff_reason: 'AI is paused for this shop' });
  });

  it('stops at the monthly allowance and says which reason it was', async () => {
    const result = await inbound({ aiReplies: 1000 });

    expect(runAgent).not.toHaveBeenCalled();
    expect(result.reply).toBeNull();
    expect(opsOn(db, 'conversations').find((op) => op.method === 'update')?.args[0]).toMatchObject({ handoff_reason: expect.stringContaining('limit') });
  });

  it('still keeps the message and the photo when it cannot answer', async () => {
    await inbound({ tenant: { ai_enabled: false } }, { media: { mimeType: 'audio/ogg', kind: 'audio', bytes: Buffer.from('voice') } });

    // A voice note the merchant has to listen to is exactly the case where the AI is not going to help.
    expect(storeMedia).toHaveBeenCalledOnce();
    expect(opsOn(db, 'messages').some((op) => op.method === 'insert')).toBe(true);
  });
});

describe('limits and duplicates', () => {
  it('refuses a flood from one visitor before it reaches the model', async () => {
    await expect(inbound({ customerMessages: 8 })).rejects.toBeInstanceOf(InboundError);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('carries the status the web chat should answer with', async () => {
    await expect(inbound({ customerMessages: 200 })).rejects.toMatchObject({ status: 429 });
  });

  it('answers a redelivered Meta message once, not twice', async () => {
    const result = await inbound(
      { insert: { error: { code: '23505' } } }, // the unique index on (tenant_id, platform_message_id)
      { channel: 'messenger', channelUserId: 'psid-abc', platformMessageId: 'm_1' },
    );

    expect(result.duplicate).toBe(true);
    expect(result.reply).toBeNull();
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('passes the platform id through so the index can do its job', async () => {
    await inbound({}, { channel: 'messenger', channelUserId: 'psid-abc', platformMessageId: 'm_2' });
    expect(opsOn(db, 'messages').find((op) => op.method === 'insert')?.args[0]).toMatchObject({ platform_message_id: 'm_2' });
  });

  it('leaves the platform id empty for web chat, where the index does not apply', async () => {
    await inbound();
    expect(opsOn(db, 'messages').find((op) => op.method === 'insert')?.args[0]).toMatchObject({ platform_message_id: null });
  });
});
