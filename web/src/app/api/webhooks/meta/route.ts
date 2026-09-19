import { after } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { auditError } from '@/lib/audit';
import { handleInbound, tenantById } from '@/lib/inbound';
import { fetchAttachment, parseWebhook, sendMessage, verifySignature, type InboundMessage, type MetaChannel } from '@/lib/meta';

// One webhook for every merchant. Meta does not tell us who the shop is — the payload names only the Page or
// Instagram account — so channel_accounts (migration 019) is what turns an incoming message into a tenant.
//
// Answer 200 first, work afterwards. Meta retries anything it does not get a quick 2xx for, and an agent turn
// takes ten seconds or more, so replying only when the answer is ready would earn duplicate deliveries and a
// duplicate reply for each. after() runs the work once the response has gone out; maxDuration keeps the
// function alive while it does.
export const maxDuration = 60;

type Account = { tenantId: string; channel: MetaChannel; externalId: string; pageToken: string };
type Db = ReturnType<typeof createAdminClient>;

// Meta's subscription check: it calls once with a token we chose, and expects the challenge echoed back.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const token = process.env.META_VERIFY_TOKEN;
  if (!token || params.get('hub.mode') !== 'subscribe' || params.get('hub.verify_token') !== token) {
    return new Response('Forbidden', { status: 403 });
  }
  return new Response(params.get('hub.challenge') ?? '', { status: 200, headers: { 'content-type': 'text/plain' } });
}

export async function POST(request: Request) {
  // The signature covers the raw bytes, so the body is read as text and parsed only once it is trusted.
  const raw = await request.text();
  if (!verifySignature(raw, request.headers.get('x-hub-signature-256'))) {
    return new Response('Invalid signature', { status: 401 });
  }

  let messages: InboundMessage[] = [];
  try {
    messages = parseWebhook(JSON.parse(raw));
  } catch {
    return new Response('Bad payload', { status: 400 }); // Signed but unreadable: retrying will not help.
  }

  if (messages.length) after(() => deliver(messages).catch((err) => auditError('meta.webhook', err)));
  return new Response('EVENT_RECEIVED', { status: 200 });
}

// Looks up every account in one query — a single delivery can carry messages for several shops — then hands
// each message to the agent pipeline.
async function deliver(messages: InboundMessage[]) {
  const db = createAdminClient();
  const { data, error } = await db
    .from('channel_accounts')
    .select('tenant_id, channel, external_id, page_token')
    .in('external_id', [...new Set(messages.map((m) => m.accountId))]);
  if (error) throw error;

  const accounts = new Map<string, Account>(
    (data ?? []).map((row) => [
      `${row.channel}:${row.external_id}`,
      { tenantId: row.tenant_id as string, channel: row.channel as MetaChannel, externalId: row.external_id as string, pageToken: row.page_token as string },
    ]),
  );

  for (const message of messages) {
    const account = accounts.get(`${message.channel}:${message.accountId}`);
    // No account means the merchant disconnected the Page but Meta has not stopped sending yet. Nothing to
    // answer with — we do not even know whose customer this is — so it is dropped, not queued.
    if (!account) {
      console.warn('[meta] message for an unconnected account', message.channel, message.accountId);
      continue;
    }
    // One at a time, in arrival order: two messages from the same customer answered in parallel would each
    // reply without seeing the other.
    await handleOneSafely(db, account, message);
  }
}

// Everything from here is the same pipeline the web chat widget uses (lib/inbound): the shop's limits, staff
// takeover, the agent, the saved reply. Only the two ends differ — the customer is a PSID instead of a cookie,
// and the reply has to be pushed back through Meta instead of returned in a response.
async function handleOne(db: Db, account: Account, message: InboundMessage) {
  // A suspended shop stops answering, but its webhooks must not error: Meta backs off an endpoint that keeps
  // failing, which would take every other shop down with it.
  const tenant = await tenantById(db, account.tenantId);
  if (!tenant) return;

  const media = message.media ? await fetchAttachment(message.media) : undefined;
  const { reply, duplicate } = await handleInbound(db, {
    tenant,
    channel: message.channel,
    channelUserId: message.senderId,
    // A photo or voice note with no caption reaches the agent as media alone, exactly as it does on the web.
    text: message.text,
    media: media ?? undefined,
    platformMessageId: message.messageId,
  });
  if (duplicate || !reply?.text) return; // Already handled, or a person has the conversation.

  await sendMessage({ externalId: account.externalId, pageToken: account.pageToken }, message.senderId, reply.text);
}

// One message failing must not stop the rest of the delivery, and must not fail the webhook: Meta would retry
// the whole batch, and the shops whose messages did go through would answer twice.
async function handleOneSafely(db: Db, account: Account, message: InboundMessage) {
  try {
    await handleOne(db, account, message);
  } catch (err) {
    await auditError('meta.inbound', err, { tenantId: account.tenantId, detail: { channel: message.channel, messageId: message.messageId } });
  }
}
