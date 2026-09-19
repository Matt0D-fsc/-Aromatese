import { createHmac, timingSafeEqual } from 'node:crypto';

// The Messenger and Instagram wire protocol, and nothing else: verify that a webhook really came from Meta,
// turn its payload into plain messages, and send a reply back out. No database, no agent — so it can be
// tested on its own, and so the rest of ChatNab never has to know Meta's shapes.
// Instagram rides the same Messenger Platform: same envelope, same Send API, only entry.id differs (an
// Instagram professional account id instead of a Page id).
// ponytail: WhatsApp is deliberately absent — it is a different API with its own pricing, and it is last in scope.

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? 'v23.0'}`;
// Messenger rejects anything longer. Agent replies are short, but a product list can run over.
const MAX_SEND_CHARS = 2000;
// Same ceiling the web chat puts on an upload, for the same reason: it all goes to the model.
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export type MetaChannel = 'messenger' | 'instagram';

// What a merchant has to grant for the agent to work: see their Pages, read and send that Page's messages,
// subscribe the Page to our webhook, and the same for the Instagram account linked to it.
const SCOPES = ['pages_show_list', 'pages_messaging', 'pages_manage_metadata', 'instagram_basic', 'instagram_manage_messages'];
// What we ask Meta to send us. Anything else (reactions, referrals, opt-ins) would be delivered and dropped.
const WEBHOOK_FIELDS = 'messages,messaging_postbacks';

export type MetaPage = {
  id: string;
  name: string;
  /** The Page token. Derived from a long-lived user token, so it does not expire on its own. */
  access_token: string;
  instagram_business_account?: { id: string; username?: string };
};

/** Where the merchant goes to grant access. `state` comes back untouched, which is how we detect a forged return. */
export function oauthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID ?? '',
    redirect_uri: redirectUri,
    state,
    scope: SCOPES.join(','),
    response_type: 'code',
  });
  return `https://www.facebook.com/${process.env.META_GRAPH_VERSION ?? 'v23.0'}/dialog/oauth?${params}`;
}

async function graph<T>(path: string, params: Record<string, string>, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GRAPH}/${path}?${new URLSearchParams(params)}`, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`Meta ${path} failed (${res.status}): ${JSON.stringify(body).slice(0, 300)}`), { status: res.status });
  return body as T;
}

/**
 * Turns the code Meta sent back into a long-lived user token. Short-lived tokens expire in about an hour, and
 * Page tokens inherit the lifetime of the user token they came from — so a shop connected with a short-lived
 * one would silently stop answering after lunch.
 */
export async function exchangeCode(code: string, redirectUri: string): Promise<string> {
  const short = await graph<{ access_token: string }>('oauth/access_token', {
    client_id: process.env.META_APP_ID ?? '',
    client_secret: process.env.META_APP_SECRET ?? '',
    redirect_uri: redirectUri,
    code,
  });
  const long = await graph<{ access_token: string }>('oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: process.env.META_APP_ID ?? '',
    client_secret: process.env.META_APP_SECRET ?? '',
    fb_exchange_token: short.access_token,
  });
  return long.access_token;
}

/** The Pages this person can message from, with the Instagram account linked to each. */
export async function listPages(userToken: string): Promise<MetaPage[]> {
  const { data } = await graph<{ data: MetaPage[] }>('me/accounts', {
    access_token: userToken,
    fields: 'id,name,access_token,instagram_business_account{id,username}',
    limit: '100',
  });
  return data ?? [];
}

/** Starts or stops delivery for one Page. Until it is subscribed, Meta sends us nothing for it. */
export async function setPageSubscription(page: { id: string; access_token: string }, subscribed: boolean): Promise<void> {
  await graph(`${page.id}/subscribed_apps`, { access_token: page.access_token, ...(subscribed && { subscribed_fields: WEBHOOK_FIELDS }) }, {
    method: subscribed ? 'POST' : 'DELETE',
  });
}

export type InboundMessage = {
  channel: MetaChannel;
  /** Page id or Instagram account id: which merchant this belongs to. */
  accountId: string;
  /** The customer's per-page scoped id (PSID/IGSID). Stable for this Page only. */
  senderId: string;
  /** Meta's message id. Retries repeat it, so it is also the deduplication key. */
  messageId: string;
  text: string;
  /** First image or voice note attached, if any. Meta serves it from a short-lived signed URL. */
  media?: { url: string; kind: 'audio' | 'image' };
  sentAt: number;
};

// Meta's webhook envelope, narrowed to the parts we read.
type WebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    messaging?: Array<{
      sender?: { id?: string };
      timestamp?: number;
      message?: {
        mid?: string;
        text?: string;
        is_echo?: boolean;
        is_deleted?: boolean;
        attachments?: Array<{ type?: string; payload?: { url?: string } }>;
      };
    }>;
  }>;
};

/**
 * True when the body really was signed by our app. Meta sends `sha256=<hex>` in `x-hub-signature-256`,
 * computed over the raw bytes — so the caller must pass the unparsed body, not a re-serialised object.
 * Returns false rather than throwing on a malformed or missing header: an unsigned request is just rejected.
 */
export function verifySignature(rawBody: string, signatureHeader: string | null | undefined): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !signatureHeader?.startsWith('sha256=')) return false;
  return safeEqual(Buffer.from(signatureHeader.slice('sha256='.length), 'hex'), createHmac('sha256', secret).update(rawBody).digest());
}

// timingSafeEqual throws on a length mismatch, which a hand-made signature can easily cause.
const safeEqual = (sent: Buffer, expected: Buffer) => sent.length === expected.length && timingSafeEqual(sent, expected);

/**
 * Reads the `signed_request` Meta posts to the data deletion callback: `<base64url signature>.<base64url payload>`,
 * signed with the app secret. Returns the person's app-scoped id, or null if anything about it is wrong —
 * this endpoint is public, so an unverified request must delete nothing.
 */
export function verifySignedRequest(signedRequest: string | null | undefined): { userId: string } | null {
  const secret = process.env.META_APP_SECRET;
  const [signature, payload] = (signedRequest ?? '').split('.');
  if (!secret || !signature || !payload) return null;

  const fromBase64Url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  // The signature covers the encoded payload exactly as sent, so it is verified before being decoded.
  if (!safeEqual(fromBase64Url(signature), createHmac('sha256', secret).update(payload).digest())) return null;

  try {
    const body = JSON.parse(fromBase64Url(payload).toString('utf8')) as { algorithm?: string; user_id?: string };
    if (body.algorithm?.toUpperCase() !== 'HMAC-SHA256' || !body.user_id) return null;
    return { userId: body.user_id };
  } catch {
    return null;
  }
}

/**
 * Webhook payload -> the customer messages inside it. One delivery can carry several, for several merchants.
 * Everything that is not a customer message — delivery receipts, read receipts, reactions, and our own
 * replies echoed back — is dropped. Echoes matter most: answering one would make the agent talk to itself.
 */
export function parseWebhook(payload: WebhookPayload): InboundMessage[] {
  const channel: MetaChannel | null = payload.object === 'page' ? 'messenger' : payload.object === 'instagram' ? 'instagram' : null;
  if (!channel) return [];

  const messages: InboundMessage[] = [];
  for (const entry of payload.entry ?? []) {
    const accountId = entry.id;
    if (!accountId) continue;

    for (const event of entry.messaging ?? []) {
      const message = event.message;
      const senderId = event.sender?.id;
      if (!message?.mid || !senderId || message.is_echo || message.is_deleted) continue;

      // Only the first attachment: a customer sending five photos at once is asking about one thing, and
      // each extra photo is another description call. Their text still arrives whole.
      const attachment = message.attachments?.find((a) => a.type === 'image' || a.type === 'audio');
      const url = attachment?.payload?.url;

      messages.push({
        channel,
        accountId,
        senderId,
        messageId: message.mid,
        text: message.text ?? '',
        media: url ? { url, kind: attachment!.type === 'audio' ? 'audio' : 'image' } : undefined,
        sentAt: event.timestamp ?? Date.now(),
      });
    }
  }
  return messages;
}

/**
 * Downloads a photo or voice note Meta is holding for us. The URL is signed and short-lived, so this has to
 * happen while the message is being handled, not later. Returns null rather than throwing: a reply about a
 * photo we could not fetch is still better than no reply.
 */
export async function fetchAttachment(media: { url: string; kind: 'audio' | 'image' }): Promise<{ mimeType: string; kind: 'audio' | 'image'; bytes: Buffer } | null> {
  try {
    const res = await fetch(media.url);
    if (!res.ok) return null;
    const length = Number(res.headers.get('content-length') ?? 0);
    if (length > MAX_ATTACHMENT_BYTES) return null;

    const bytes = Buffer.from(await res.arrayBuffer());
    // Checked again after the download: Meta does not always send a content-length.
    if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES) return null;

    const mimeType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    return { mimeType: mimeType || (media.kind === 'audio' ? 'audio/mpeg' : 'image/jpeg'), kind: media.kind, bytes };
  } catch {
    return null;
  }
}

/**
 * Sends a reply as the merchant's Page. Throws on a Meta error so the caller can audit it — a reply that
 * never left is worse than a visible failure, because the customer is sitting there waiting.
 */
export async function sendMessage(account: { externalId: string; pageToken: string }, recipientId: string, text: string): Promise<void> {
  for (const chunk of splitForSend(text)) {
    const res = await fetch(`${GRAPH}/${account.externalId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${account.pageToken}` },
      body: JSON.stringify({ recipient: { id: recipientId }, message: { text: chunk }, messaging_type: 'RESPONSE' }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw Object.assign(new Error(`Meta send failed (${res.status}): ${body.slice(0, 300)}`), { status: res.status });
    }
  }
}

// Long replies go out as several messages, split on a line or sentence break so a price list never breaks
// mid-number. Messenger keeps the order it receives them in.
function splitForSend(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_SEND_CHARS) return trimmed ? [trimmed] : [];

  const chunks: string[] = [];
  let rest = trimmed;
  while (rest.length > MAX_SEND_CHARS) {
    const window = rest.slice(0, MAX_SEND_CHARS);
    // A line break first, and only then a sentence end: "2. Silk saree" holds a full stop that is not the end
    // of anything, and cutting there would split a product off its number.
    const line = window.lastIndexOf('\n');
    const cut = line > MAX_SEND_CHARS / 2 ? line : Math.max(window.lastIndexOf('। '), window.lastIndexOf('. '));
    const at = cut > MAX_SEND_CHARS / 2 ? cut + 1 : MAX_SEND_CHARS;
    chunks.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}
