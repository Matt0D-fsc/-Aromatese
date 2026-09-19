import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAttachment, parseWebhook, sendMessage, verifySignature, verifySignedRequest } from '../web/src/lib/meta.js';

// The Messenger/Instagram wire protocol. Two things here are security, not formatting: an unsigned webhook
// must never be accepted, and our own replies echoed back must never be answered (the agent would talk to
// itself forever, spending the shop's whole monthly allowance on one conversation).

const SECRET = 'test-app-secret-not-real';
const sign = (body: string) => `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;

const messengerPayload = (message: Record<string, unknown>) => ({
  object: 'page',
  entry: [{ id: '1015551234', messaging: [{ sender: { id: 'psid-abc' }, recipient: { id: '1015551234' }, timestamp: 1758300000000, message }] }],
});

beforeEach(() => {
  process.env.META_APP_SECRET = SECRET;
});

describe('verifySignature', () => {
  const body = JSON.stringify(messengerPayload({ mid: 'm_1', text: 'Silk saree dekhao' }));

  it('accepts a body signed with the app secret', () => {
    expect(verifySignature(body, sign(body))).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(verifySignature(body.replace('saree', 'kurti'), sign(body))).toBe(false);
  });

  it('rejects a missing, malformed or wrong-length header without throwing', () => {
    // timingSafeEqual throws when the buffers differ in length, which any hand-made header causes.
    for (const header of [null, undefined, '', 'deadbeef', 'sha256=', 'sha256=zz', 'sha256=abcd', 'sha1=' + 'a'.repeat(40)]) {
      expect(verifySignature(body, header)).toBe(false);
    }
  });

  it('rejects everything when the app secret is not configured', () => {
    delete process.env.META_APP_SECRET;
    expect(verifySignature(body, sign(body))).toBe(false);
  });
});

describe('parseWebhook', () => {
  it('reads a Messenger text message', () => {
    expect(parseWebhook(messengerPayload({ mid: 'm_1', text: 'Silk saree dekhao' }))).toEqual([
      { channel: 'messenger', accountId: '1015551234', senderId: 'psid-abc', messageId: 'm_1', text: 'Silk saree dekhao', media: undefined, sentAt: 1758300000000 },
    ]);
  });

  it('reads an Instagram message from the same envelope', () => {
    const [message] = parseWebhook({
      object: 'instagram',
      entry: [{ id: 'ig-77', messaging: [{ sender: { id: 'igsid-9' }, timestamp: 1758300000001, message: { mid: 'm_ig', text: 'price koto?' } }] }],
    });
    expect(message).toMatchObject({ channel: 'instagram', accountId: 'ig-77', senderId: 'igsid-9', text: 'price koto?' });
  });

  it('keeps a photo or voice note, and only the first', () => {
    const photo = parseWebhook(
      messengerPayload({
        mid: 'm_2',
        attachments: [
          { type: 'image', payload: { url: 'https://cdn.meta/1.jpg' } },
          { type: 'image', payload: { url: 'https://cdn.meta/2.jpg' } },
        ],
      }),
    );
    expect(photo[0].media).toEqual({ url: 'https://cdn.meta/1.jpg', kind: 'image' });

    const voice = parseWebhook(messengerPayload({ mid: 'm_3', attachments: [{ type: 'audio', payload: { url: 'https://cdn.meta/v.mp4' } }] }));
    expect(voice[0].media).toEqual({ url: 'https://cdn.meta/v.mp4', kind: 'audio' });

    // A sticker or a share is not something the agent can look at; the message still arrives.
    const sticker = parseWebhook(messengerPayload({ mid: 'm_4', text: 'hi', attachments: [{ type: 'fallback', payload: {} }] }));
    expect(sticker[0].media).toBeUndefined();
  });

  it('ignores our own replies echoed back', () => {
    expect(parseWebhook(messengerPayload({ mid: 'm_5', text: 'Ei saree tar dam 2500 taka.', is_echo: true }))).toEqual([]);
  });

  it('ignores delivery and read receipts', () => {
    const payload = {
      object: 'page',
      entry: [
        {
          id: '1015551234',
          messaging: [
            { sender: { id: 'psid-abc' }, timestamp: 1, delivery: { mids: ['m_1'], watermark: 1 } },
            { sender: { id: 'psid-abc' }, timestamp: 2, read: { watermark: 2 } },
          ],
        },
      ],
    };
    expect(parseWebhook(payload)).toEqual([]);
  });

  it('splits one delivery across the shops it belongs to', () => {
    const messages = parseWebhook({
      object: 'page',
      entry: [
        { id: 'page-a', messaging: [{ sender: { id: 'psid-1' }, timestamp: 1, message: { mid: 'm_a', text: 'ek' } }] },
        { id: 'page-b', messaging: [{ sender: { id: 'psid-2' }, timestamp: 2, message: { mid: 'm_b', text: 'dui' } }] },
      ],
    });
    expect(messages.map((m) => m.accountId)).toEqual(['page-a', 'page-b']);
  });

  it('ignores payloads that are not Messenger or Instagram, and junk', () => {
    expect(parseWebhook({ object: 'whatsapp_business_account', entry: [{ id: 'wa', changes: [] }] } as never)).toEqual([]);
    expect(parseWebhook({})).toEqual([]);
    expect(parseWebhook({ object: 'page', entry: [{ messaging: [{ message: { text: 'no mid, no sender' } }] }] })).toEqual([]);
  });
});

describe('sendMessage', () => {
  const account = { externalId: '1015551234', pageToken: 'page-token-not-real' };
  const ok = () => new Response('{"message_id":"m_out"}', { status: 200 });

  afterEach(() => vi.unstubAllGlobals());

  it('posts the reply to the merchant account with its own token', async () => {
    const fetchMock = vi.fn(ok);
    vi.stubGlobal('fetch', fetchMock);
    await sendMessage(account, 'psid-abc', 'Ei saree tar dam 2500 taka.');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/1015551234/messages');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer page-token-not-real');
    expect(JSON.parse(init.body as string)).toEqual({ recipient: { id: 'psid-abc' }, message: { text: 'Ei saree tar dam 2500 taka.' }, messaging_type: 'RESPONSE' });
  });

  it('splits a reply over the 2000 character limit, on a line break', async () => {
    const fetchMock = vi.fn(ok);
    vi.stubGlobal('fetch', fetchMock);
    const long = Array.from({ length: 60 }, (_, i) => `${i}. Silk saree, 2500 taka, stock ache`).join('\n');
    await sendMessage(account, 'psid-abc', long);

    const chunks = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body as string).message.text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c: string) => c.length <= 2000)).toBe(true);
    // Nothing lost and nothing reordered: the lines arrive as they were written.
    expect(chunks.join('\n')).toBe(long);
  });

  it('throws with Meta status when the send is refused', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"message":"outside allowed window"}}', { status: 400 })));
    await expect(sendMessage(account, 'psid-abc', 'hi')).rejects.toMatchObject({ status: 400 });
  });

  it('sends nothing at all for an empty reply', async () => {
    const fetchMock = vi.fn(ok);
    vi.stubGlobal('fetch', fetchMock);
    await sendMessage(account, 'psid-abc', '   ');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('fetchAttachment', () => {
  const photo = { url: 'https://cdn.meta/1.jpg', kind: 'image' as const };
  const reply = (body: Buffer | string, headers: Record<string, string>, status = 200) => new Response(body, { status, headers });

  afterEach(() => vi.unstubAllGlobals());

  it('downloads the file and keeps the type Meta served it as', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(Buffer.from('jpegbytes'), { 'content-type': 'image/jpeg; charset=binary' })));
    expect(await fetchAttachment(photo)).toEqual({ mimeType: 'image/jpeg', kind: 'image', bytes: Buffer.from('jpegbytes') });
  });

  it('falls back to a sensible type when Meta sends none', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(Buffer.from('x'), {})));
    expect((await fetchAttachment({ url: 'https://cdn.meta/v.mp4', kind: 'audio' }))?.mimeType).toBe('audio/mpeg');
  });

  it('refuses a file over 5 MB, by header and by what actually arrives', async () => {
    const big = Buffer.alloc(6 * 1024 * 1024);
    vi.stubGlobal('fetch', vi.fn(async () => reply(big, { 'content-type': 'image/jpeg', 'content-length': String(big.length) })));
    expect(await fetchAttachment(photo)).toBeNull();

    // Meta does not always send content-length, so the downloaded size is checked too.
    vi.stubGlobal('fetch', vi.fn(async () => reply(big, { 'content-type': 'image/jpeg' })));
    expect(await fetchAttachment(photo)).toBeNull();
  });

  it('returns null instead of throwing when the signed URL has expired or the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply('gone', { 'content-type': 'text/plain' }, 404)));
    expect(await fetchAttachment(photo)).toBeNull();

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
    expect(await fetchAttachment(photo)).toBeNull();

    vi.stubGlobal('fetch', vi.fn(async () => reply(Buffer.alloc(0), { 'content-type': 'image/jpeg' })));
    expect(await fetchAttachment(photo)).toBeNull();
  });
});

describe('verifySignedRequest', () => {
  // Meta's data deletion callback: "<base64url signature>.<base64url payload>". This is the only thing
  // standing between a public endpoint and every customer's chat history, so it fails closed on everything.
  const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const make = (payload: object, secret = SECRET) => {
    const encoded = b64url(Buffer.from(JSON.stringify(payload)));
    return `${b64url(createHmac('sha256', secret).update(encoded).digest())}.${encoded}`;
  };
  const valid = { algorithm: 'HMAC-SHA256', issued_at: 1758300000, user_id: 'psid-abc' };

  it('reads the person out of a properly signed request', () => {
    expect(verifySignedRequest(make(valid))).toEqual({ userId: 'psid-abc' });
  });

  it('refuses a request signed with the wrong secret', () => {
    expect(verifySignedRequest(make(valid, 'someone-elses-secret'))).toBeNull();
  });

  it('refuses a payload swapped after signing', () => {
    const [signature] = make(valid).split('.');
    const swapped = b64url(Buffer.from(JSON.stringify({ ...valid, user_id: 'psid-victim' })));
    expect(verifySignedRequest(`${signature}.${swapped}`)).toBeNull();
  });

  it('refuses junk, missing halves and an empty request', () => {
    for (const request of [null, undefined, '', 'no-dot', '.', 'aaa.bbb', `${'a'.repeat(43)}.${b64url(Buffer.from('{}'))}`]) {
      expect(verifySignedRequest(request)).toBeNull();
    }
  });

  it('refuses a signed request that names no person, or a different algorithm', () => {
    expect(verifySignedRequest(make({ algorithm: 'HMAC-SHA256', issued_at: 1 }))).toBeNull();
    expect(verifySignedRequest(make({ algorithm: 'PLAINTEXT', user_id: 'psid-abc' }))).toBeNull();
  });

  it('refuses everything when the app secret is not configured', () => {
    const request = make(valid);
    delete process.env.META_APP_SECRET;
    expect(verifySignedRequest(request)).toBeNull();
  });
});
