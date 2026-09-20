import { beforeEach, describe, expect, it, vi } from 'vitest';

// The public chat endpoint's own job, now that the pipeline lives in lib/inbound: decide what a stranger is
// allowed to post, hand the visitor a cookie, and turn a failure into the right status code. It is the only
// unauthenticated write in the product, so what it refuses matters more than what it accepts.

const handleInbound = vi.fn();
const tenantBySlug = vi.fn();
const jar = new Map<string, { value: string }>();
const setCookie = vi.fn((name: string, value: string) => jar.set(name, { value }));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => jar.get(name), set: setCookie }),
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.7' }),
}));
vi.mock('@/lib/audit', () => ({ audit: vi.fn(), auditError: vi.fn(), throwAudited: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/inbound', async () => {
  const actual = await vi.importActual<typeof import('../web/src/lib/inbound.js')>('../web/src/lib/inbound.js');
  return { ...actual, handleInbound: (...args: unknown[]) => handleInbound(...args), tenantBySlug: (...args: unknown[]) => tenantBySlug(...args) };
});

const { POST } = await import('../web/src/app/api/chat/[slug]/route.js');
const { InboundError } = await import('../web/src/lib/inbound.js');

const TENANT = { id: 'a3f1c0de-0000-4000-8000-000000000001', name: 'Rupali Boutique', status: 'active', ai_enabled: true, monthly_message_limit: 1000 };

const post = (form: FormData, slug = 'rupali') =>
  POST(new Request('http://localhost/api/chat/rupali', { method: 'POST', body: form }), { params: Promise.resolve({ slug }) } as never);

const textForm = (text: string) => {
  const form = new FormData();
  form.set('text', text);
  return form;
};

const fileForm = (type: string, bytes = 10) => {
  const form = new FormData();
  form.set('file', new File([new Uint8Array(bytes)], 'upload', { type }));
  return form;
};

beforeEach(() => {
  jar.clear();
  setCookie.mockClear();
  handleInbound.mockReset().mockResolvedValue({ reply: { id: 'm1', text: 'hi' }, staff: false, conversationId: 'd1' });
  tenantBySlug.mockReset().mockResolvedValue(TENANT);
});

describe('what it refuses', () => {
  it('turns away a shop that does not exist or is not active', async () => {
    tenantBySlug.mockResolvedValue(null);
    const res = await post(textForm('hello'), 'no-such-shop');

    expect(res.status).toBe(404);
    expect(handleInbound).not.toHaveBeenCalled();
  });

  it('takes photos and voice notes, and nothing else', async () => {
    expect((await post(fileForm('image/jpeg'))).status).toBe(200);
    expect((await post(fileForm('audio/ogg'))).status).toBe(200);
    // A PDF or an executable is not something the agent can read, and not something to keep in the bucket.
    expect((await post(fileForm('application/pdf'))).status).toBe(415);
    expect((await post(fileForm('application/x-msdownload'))).status).toBe(415);
  });

  it('refuses a file over 5 MB before reading it into memory', async () => {
    const res = await post(fileForm('image/jpeg', 6 * 1024 * 1024));
    expect(res.status).toBe(413);
    expect(handleInbound).not.toHaveBeenCalled();
  });

  it('refuses an empty message', async () => {
    expect((await post(textForm('   '))).status).toBe(400);
    expect((await post(new FormData())).status).toBe(400);
  });

  it('refuses a body that is not a form at all', async () => {
    const res = await POST(new Request('http://localhost/api/chat/rupali', { method: 'POST', body: 'not-a-form', headers: { 'content-type': 'text/plain' } }), {
      params: Promise.resolve({ slug: 'rupali' }),
    } as never);
    expect(res.status).toBe(400);
  });

  it('cuts a very long message down rather than rejecting it', async () => {
    await post(textForm('a'.repeat(5000)));
    expect((handleInbound.mock.calls[0][1] as { text: string }).text).toHaveLength(2000);
  });
});

describe('the visitor cookie', () => {
  it('issues one on the first message, and it is not readable by scripts', async () => {
    await post(textForm('hello'));

    expect(setCookie).toHaveBeenCalledOnce();
    const [name, value, options] = setCookie.mock.calls[0] as unknown as [string, string, { httpOnly: boolean; sameSite: string }];
    expect(value).toMatch(/^[0-9a-f-]{36}$/);
    expect(options).toMatchObject({ httpOnly: true, sameSite: 'lax' });
    expect((handleInbound.mock.calls[0][1] as { channelUserId: string }).channelUserId).toBe(value);
    expect(name).toBeTruthy();
  });

  it('keeps the one the visitor already has, so the chat continues', async () => {
    jar.set('cn_visitor', { value: '11111111-2222-4333-8444-555555555555' });
    await post(textForm('ar ekta dekhao'));

    expect(setCookie).not.toHaveBeenCalled();
    expect((handleInbound.mock.calls[0][1] as { channelUserId: string }).channelUserId).toBe('11111111-2222-4333-8444-555555555555');
  });

  it('replaces a cookie value that was tampered with', async () => {
    jar.set('cn_visitor', { value: "'; drop table messages; --" });
    await post(textForm('hello'));

    expect(setCookie).toHaveBeenCalledOnce();
    expect((handleInbound.mock.calls[0][1] as { channelUserId: string }).channelUserId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('hashes the visitor’s address instead of storing it', async () => {
    await post(textForm('hello'));

    const ipHash = (handleInbound.mock.calls[0][1] as { ipHash: string }).ipHash;
    expect(ipHash).toMatch(/^[0-9a-f]{32}$/);
    expect(ipHash).not.toContain('203.0.113.7');
  });
});

describe('what it answers with', () => {
  it('passes a rate limit back with its own status and wording', async () => {
    handleInbound.mockRejectedValue(new InboundError(429, 'You are sending messages too fast. Please wait a moment.'));
    const res = await post(textForm('spam'));

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'You are sending messages too fast. Please wait a moment.' });
  });

  it('says the AI is busy when every model is out of quota, not that the shop is broken', async () => {
    handleInbound.mockRejectedValue(Object.assign(new Error('quota'), { status: 429 }));
    const res = await post(textForm('hello'));

    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/busy/i);
  });

  it('gives a plain failure for anything else, without leaking the reason', async () => {
    handleInbound.mockRejectedValue(new Error('supabase: relation "messages" does not exist'));
    const res = await post(textForm('hello'));

    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toMatch(/supabase|relation/);
  });

  it('tells the page a person is handling the chat, so it stops waiting on the AI', async () => {
    handleInbound.mockResolvedValue({ reply: null, staff: true, conversationId: 'd1' });
    expect(await (await post(textForm('hello'))).json()).toEqual({ reply: null, staff: true });

    handleInbound.mockResolvedValue({ reply: null, staff: false, conversationId: 'd1' });
    expect(await (await post(textForm('hello'))).json()).toEqual({ reply: null });
  });
});
