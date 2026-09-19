import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exchangeCode, listPages, oauthUrl, setPageSubscription } from '../web/src/lib/meta.js';
import { fetchCalls } from './fetch-calls.js';

// Connecting a merchant's Facebook Page. The trap here is token lifetime: a Page token inherits the lifetime
// of the user token it came from, so connecting with the short-lived one Meta hands back would leave a shop
// that works this afternoon and goes silent by evening.

const REDIRECT = 'https://chatnab.example/api/meta/callback';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  process.env.META_APP_ID = '1234567890';
  process.env.META_APP_SECRET = 'app-secret-not-real';
});
afterEach(() => vi.unstubAllGlobals());

describe('oauthUrl', () => {
  it('asks for exactly the permissions the agent needs, and carries the state back', () => {
    const params = new URL(oauthUrl(REDIRECT, 'state-abc')).searchParams;
    expect(params.get('client_id')).toBe('1234567890');
    expect(params.get('redirect_uri')).toBe(REDIRECT);
    expect(params.get('state')).toBe('state-abc');
    expect(params.get('scope')?.split(',').sort()).toEqual(
      ['instagram_basic', 'instagram_manage_messages', 'pages_manage_metadata', 'pages_messaging', 'pages_show_list'].sort(),
    );
  });
});

describe('exchangeCode', () => {
  it('trades the code for a short token, then trades that for a long-lived one', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ access_token: 'short-lived', expires_in: 3600 }))
      .mockResolvedValueOnce(json({ access_token: 'long-lived', expires_in: 5184000 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await exchangeCode('the-code', REDIRECT)).toBe('long-lived');

    const first = new URL(fetchCalls(fetchMock)[0][0]).searchParams;
    expect(first.get('code')).toBe('the-code');
    expect(first.get('client_secret')).toBe('app-secret-not-real');

    // The second call is the one that matters: without it the Page token expires within the hour.
    const second = new URL(fetchCalls(fetchMock)[1][0]).searchParams;
    expect(second.get('grant_type')).toBe('fb_exchange_token');
    expect(second.get('fb_exchange_token')).toBe('short-lived');
  });

  it('throws with Meta status when the code is stale or already used', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { message: 'This authorization code has expired.' } }, 400)));
    await expect(exchangeCode('used-code', REDIRECT)).rejects.toMatchObject({ status: 400 });
  });
});

describe('listPages', () => {
  it('asks for the token and the linked Instagram account with each Page', async () => {
    const fetchMock = vi.fn(async () =>
      json({
        data: [
          { id: 'page-1', name: 'Rupali Boutique', access_token: 'page-token', instagram_business_account: { id: 'ig-77', username: 'rupali' } },
          { id: 'page-2', name: 'Side Project', access_token: 'page-token-2' },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const pages = await listPages('long-lived');
    expect(pages.map((p) => p.id)).toEqual(['page-1', 'page-2']);
    expect(pages[0].instagram_business_account?.id).toBe('ig-77');
    // Without instagram_business_account in the fields, an Instagram-linked Page would look Messenger-only.
    expect(new URL(fetchCalls(fetchMock)[0][0]).searchParams.get('fields')).toContain('instagram_business_account');
  });

  it('returns nothing when the account manages no Page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: [] })));
    expect(await listPages('long-lived')).toEqual([]);
  });
});

describe('setPageSubscription', () => {
  const page = { id: 'page-1', access_token: 'page-token' };

  it('subscribes with the fields we can actually handle', async () => {
    const fetchMock = vi.fn(async () => json({ success: true }));
    vi.stubGlobal('fetch', fetchMock);
    await setPageSubscription(page, true);

    const [url, init] = fetchCalls(fetchMock)[0];
    expect(init.method).toBe('POST');
    expect(url).toContain('/page-1/subscribed_apps');
    expect(new URL(url).searchParams.get('subscribed_fields')).toBe('messages,messaging_postbacks');
  });

  it('unsubscribes without naming fields, which would re-subscribe them', async () => {
    const fetchMock = vi.fn(async () => json({ success: true }));
    vi.stubGlobal('fetch', fetchMock);
    await setPageSubscription(page, false);

    const [url, init] = fetchCalls(fetchMock)[0];
    expect(init.method).toBe('DELETE');
    expect(new URL(url).searchParams.has('subscribed_fields')).toBe(false);
  });
});
