import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCalls } from './fetch-calls.js';

// Sending a staff reply back out to the channel the customer is actually on. The case that matters most is
// the boring one: a web chat must not touch Meta at all, because that path carries every existing shop.

const rows: { conversation?: unknown; customer?: unknown; account?: unknown } = {};

// Just enough of the Supabase client for the three lookups deliverToConversation makes.
const table = (row: unknown) => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: row ?? null }),
  };
  return chain;
};

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (name: string) => table(name === 'conversations' ? rows.conversation : name === 'customers' ? rows.customer : rows.account),
  }),
}));

const { deliverToConversation, DeliveryError } = await import('../web/src/lib/channels.js');

const TENANT = 'a3f1c0de-0000-4000-8000-000000000001';
const CONVERSATION = 'b4f1c0de-0000-4000-8000-000000000002';

const setUp = (channel: string, account: unknown = { external_id: '1015551234', page_token: 'page-token-not-real' }) => {
  rows.conversation = { channel, customer_id: 'cust-1' };
  rows.customer = { channel_user_id: 'psid-abc' };
  rows.account = account;
};

afterEach(() => vi.unstubAllGlobals());

describe('deliverToConversation', () => {
  it('does nothing for a web chat: saving the row is the delivery there', async () => {
    setUp('web');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await deliverToConversation(TENANT, CONVERSATION, 'Apnar order confirm hoyeche.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a Messenger reply as the shop, to the right customer', async () => {
    setUp('messenger');
    const fetchMock = vi.fn(async () => new Response('{"message_id":"m_out"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await deliverToConversation(TENANT, CONVERSATION, 'Apnar order confirm hoyeche.');

    const [url, init] = fetchCalls(fetchMock)[0];
    expect(url).toContain('/1015551234/messages');
    expect(JSON.parse(init.body as string).recipient).toEqual({ id: 'psid-abc' });
  });

  it('explains the 24-hour window instead of failing silently', async () => {
    setUp('instagram');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"message":"outside window"}}', { status: 400 })));
    await expect(deliverToConversation(TENANT, CONVERSATION, 'hello')).rejects.toThrow(/24 hours/);
  });

  it('names the disconnected channel when the Page is gone', async () => {
    setUp('instagram', null);
    await expect(deliverToConversation(TENANT, CONVERSATION, 'hello')).rejects.toThrow(/Instagram/);
    setUp('messenger', null);
    await expect(deliverToConversation(TENANT, CONVERSATION, 'hello')).rejects.toBeInstanceOf(DeliveryError);
  });

  it('asks staff to retry when Meta is simply unreachable', async () => {
    setUp('messenger');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream', { status: 503 })));
    await expect(deliverToConversation(TENANT, CONVERSATION, 'hello')).rejects.toThrow(/try again/);
  });

  it('does nothing when the conversation is not this shop’s', async () => {
    rows.conversation = null;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await deliverToConversation(TENANT, CONVERSATION, 'hello');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
