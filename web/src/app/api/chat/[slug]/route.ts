import { createHash } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { auditError } from '@/lib/audit';
import {
  aiReply,
  handleInbound,
  InboundError,
  recentHistory,
  tenantBySlug,
  withinMonthlyLimit,
  CONVERSATION_COLUMNS,
  STAFF_REPLY_TIMEOUT_MS,
} from '@/lib/inbound';
import { MESSAGE_COLUMNS, VISITOR_COOKIE, toChatLine, type MessageRow } from '@/lib/chat';

// The public chat widget's endpoint. Everything a message does once it arrives — limits, staff takeover,
// the agent, saving the reply — lives in lib/inbound, shared with the Meta webhook. What is left here is
// what only the web widget has: a file upload, a visitor cookie, an IP to rate-limit, and HTTP status codes.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT = 2000;
const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

const fail = (status: number, error: string) => Response.json({ error }, { status });
const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : 0);

function agentFailed(err: unknown, tenantId: string) {
  void auditError('chat.agent', err, { tenantId });
  // 429/503 = every model is out of quota or overloaded right now; say so instead of looking broken.
  const status = (err as { status?: number })?.status;
  return status === 429 || status === 503
    ? fail(429, 'AI ekhon onek bochchi busy. Ektu pore abar try korun, ba shop team ke wait korun.')
    : fail(502, 'Dukkhito, reply dite parlam na. Abar try korun.');
}

// Salted so the stored value cannot be reversed into an IP by trying every address.
// ponytail: x-forwarded-for is trusted, which is right behind Vercel or another proxy that sets it; a server
// exposed directly to the internet would need the socket address instead.
async function clientIpHash() {
  const h = await headers();
  const ip = (h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip') ?? '').trim();
  return ip ? createHash('sha256').update(`${ip}:${process.env.SUPABASE_SERVICE_ROLE_KEY}`).digest('hex').slice(0, 32) : null;
}

// Customer sends a message. Public endpoint: anyone with the shop's chat link can talk to its agent.
// AI cost is capped per shop by monthly_message_limit, a number of AI replies (set in the admin panel). Within that, per-visitor and
// per-connection limits stop one person from spending the whole allowance and silencing the shop's AI.
export async function POST(request: Request, ctx: RouteContext<'/api/chat/[slug]'>) {
  const { slug } = await ctx.params;
  const form = await request.formData().catch(() => null);
  if (!form) return fail(400, 'Bad request.');

  const text = String(form.get('text') ?? '').trim().slice(0, MAX_TEXT);
  const file = form.get('file');
  const media = file instanceof File && file.size > 0 ? file : null;
  const mimeType = media ? media.type.split(';')[0].trim().toLowerCase() : '';
  const kind = !media ? 'text' : mimeType.startsWith('audio/') ? 'audio' : mimeType.startsWith('image/') ? 'image' : null;
  if (!kind) return fail(415, 'Only photos and voice notes can be sent.');
  if (media && media.size > MAX_MEDIA_BYTES) return fail(413, 'File is too large (max 5 MB).');
  if (!media && !text) return fail(400, 'Type a message.');
  const mediaBytes = media ? Buffer.from(await media.arrayBuffer()) : null;

  const db = createAdminClient();
  const tenant = await tenantBySlug(db, slug);
  if (!tenant) return fail(404, 'This shop is not available.');

  const jar = await cookies();
  let visitor = jar.get(VISITOR_COOKIE)?.value ?? '';
  if (!UUID.test(visitor)) {
    visitor = crypto.randomUUID();
    jar.set(VISITOR_COOKIE, visitor, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  try {
    const { reply, staff } = await handleInbound(db, {
      tenant,
      channel: 'web',
      channelUserId: visitor,
      text,
      media: mediaBytes ? { mimeType, kind: kind as 'audio' | 'image', bytes: mediaBytes } : undefined,
      ipHash: await clientIpHash(),
    });
    return Response.json({ reply, staff: staff || undefined });
  } catch (err) {
    if (err instanceof InboundError) return fail(err.status, err.message);
    return agentFailed(err, tenant.id);
  }
}

// The customer's chat polls this for staff replies (visitors are anonymous, so they can't subscribe to the database).
// It also lets the AI step back in when staff took over but left the customer waiting.
export async function GET(request: Request, ctx: RouteContext<'/api/chat/[slug]'>) {
  const { slug } = await ctx.params;
  const after = new URL(request.url).searchParams.get('after');
  const db = createAdminClient();
  const tenant = await tenantBySlug(db, slug);
  if (!tenant) return fail(404, 'This shop is not available.');

  const visitor = (await cookies()).get(VISITOR_COOKIE)?.value ?? '';
  if (!UUID.test(visitor)) return Response.json({ messages: [] });
  const { data: customer } = await db
    .from('customers')
    .select('id')
    .eq('tenant_id', tenant.id)
    .eq('channel', 'web')
    .eq('channel_user_id', visitor)
    .maybeSingle();
  const { data: conversation } = customer
    ? await db.from('conversations').select(CONVERSATION_COLUMNS).eq('tenant_id', tenant.id).eq('customer_id', customer.id).eq('channel', 'web').maybeSingle()
    : { data: null };
  if (!customer || !conversation) return Response.json({ messages: [] });

  if (conversation.ai_muted && tenant.ai_enabled) {
    const { data: last } = await db
      .from('messages')
      .select('sender_type, created_at')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const waitingSince = Math.max(ms(last?.created_at), ms(conversation.taken_over_at));
    if (last?.sender_type === 'customer' && Date.now() - waitingSince > STAFF_REPLY_TIMEOUT_MS && (await withinMonthlyLimit(db, tenant))) {
      // The conditional update is the lock: with several polls in flight, only one wakes the AI.
      const { data: claimed } = await db.from('conversations').update({ ai_muted: false }).eq('id', conversation.id).eq('ai_muted', true).select('id');
      if (claimed?.length) {
        await aiReply(db, {
          tenant,
          customerId: customer.id,
          conversationId: conversation.id,
          history: await recentHistory(db, conversation.id),
          userText: "[The shop team did not reply within 5 minutes. Apologise briefly for the wait, then help with the customer's last message.]",
        }).catch((err) => console.error('[chat] staff-timeout reply failed', err));
      }
    }
  }

  let query = db
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('tenant_id', tenant.id)
    .eq('conversation_id', conversation.id)
    .neq('sender_type', 'customer');
  if (after && !Number.isNaN(Date.parse(after))) query = query.gt('created_at', after);
  const { data } = await query.order('created_at', { ascending: true }).limit(20);
  return Response.json({ messages: ((data ?? []) as MessageRow[]).map(toChatLine) });
}
