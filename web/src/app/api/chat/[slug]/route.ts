import { createHash } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { runAgent, type AgentInput } from '@/lib/agent';
import { storeMedia } from '@/lib/media';
import { audit, auditError } from '@/lib/audit';
import { monthStart, usageLevel } from '@/lib/usage';
import { MESSAGE_COLUMNS, VISITOR_COOKIE, toChatLine, type ChatLine, type MessageRow } from '@/lib/chat';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT = 2000;
const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
const MAX_PER_MINUTE = 8;
const MAX_PER_DAY = 150; // one visitor, one shop
// Per connection, across every visitor behind it. Generous on purpose: Bangladeshi mobile networks put many
// customers behind one shared IP (carrier NAT), and a real shop's customers must never be blocked by each other.
const MAX_PER_IP_MINUTE = 40;
const MAX_PER_IP_DAY = 400;
const HISTORY_MESSAGES = 20;
const STAFF_REPLY_TIMEOUT_MS = 5 * 60_000; // customer left waiting on staff this long -> the AI steps back in
const STAFF_IDLE_HANDBACK_MS = 30 * 60_000; // staff silent this long -> the next customer message goes to the AI

const TENANT_COLUMNS = 'id, name, business_category, status, ai_enabled, monthly_message_limit, policies, ai_persona, ai_playbook';
const CONVERSATION_COLUMNS = 'id, ai_muted, taken_over_at, last_staff_reply_at';

type Db = ReturnType<typeof createAdminClient>;
type Tenant = { id: string; name: string; business_category: string | null; status: string; ai_enabled: boolean; monthly_message_limit: number; policies: unknown; ai_persona: unknown; ai_playbook: unknown };

const fail = (status: number, error: string) => Response.json({ error }, { status });
const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : 0);

async function activeTenant(db: Db, slug: string) {
  const { data } = await db.from('tenants').select(TENANT_COLUMNS).eq('slug', slug).maybeSingle();
  return data?.status === 'active' ? (data as Tenant) : null;
}

async function withinMonthlyLimit(db: Db, tenant: Tenant) {
  const since = monthStart().toISOString();
  const { count } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id)
    .eq('sender_type', 'bot') // the limit caps the AI's replies; customers and staff are free
    .gte('created_at', since);
  const used = count ?? 0;
  const level = usageLevel(used, tenant.monthly_message_limit);
  // Once per shop per month for each level, so the admin activity feed shows it without repeating it on every
  // message. Never delays the reply.
  if (level !== 'ok') void alertOnce(db, tenant.id, level === 'out' ? 'usage.limit_reached' : 'usage.limit_warning', since, { used, limit: tenant.monthly_message_limit });
  return level !== 'out';
}

// ponytail: check-then-insert can record twice if two messages cross the line at once; a duplicate feed row is harmless.
async function alertOnce(db: Db, tenantId: string, event: string, since: string, detail: Record<string, unknown>) {
  const { count } = await db.from('audit_logs').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('event_type', event).gte('created_at', since);
  if (!count) await audit(event, { tenantId, detail });
}

async function recentHistory(db: Db, conversationId: string) {
  const { data } = await db
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_MESSAGES);
  return ((data ?? []) as MessageRow[]).reverse();
}

// Runs the agent and saves its reply. Returns null when staff took over while the AI was thinking,
// so the AI never talks over a person.
async function aiReply(db: Db, input: AgentInput): Promise<ChatLine | null> {
  const result = await runAgent(input);

  const { data: latest } = await db.from('conversations').select('ai_muted').eq('id', input.conversationId).single();
  if (latest?.ai_muted) return null;

  const { data: reply, error } = await db
    .from('messages')
    .insert({
      tenant_id: input.tenant.id,
      conversation_id: input.conversationId,
      sender_type: 'bot',
      content_type: 'text',
      content_text: result.text,
      grounding_data: { products: result.products, orderNumber: result.orderNumber ?? undefined, tools: result.toolCalls },
      prompt_tokens: result.promptTokens,
      output_tokens: result.outputTokens,
    })
    .select(MESSAGE_COLUMNS)
    .single();
  if (error) throw error;

  await db.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', input.conversationId);
  return toChatLine(reply as MessageRow);
}

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

const since = (ms: number) => new Date(Date.now() - ms).toISOString();

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
  const tenant = await activeTenant(db, slug);
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

  const { data: customer, error: customerError } = await db
    .from('customers')
    .upsert({ tenant_id: tenant.id, channel: 'web', channel_user_id: visitor }, { onConflict: 'tenant_id,channel,channel_user_id' })
    .select('id')
    .single();
  if (customerError) return fail(500, 'Chat is unavailable right now.');

  const { data: conversation, error: conversationError } = await db
    .from('conversations')
    .upsert(
      { tenant_id: tenant.id, customer_id: customer.id, channel: 'web', last_message_at: new Date().toISOString() },
      { onConflict: 'tenant_id,customer_id,channel' },
    )
    .select(CONVERSATION_COLUMNS)
    .single();
  if (conversationError) return fail(500, 'Chat is unavailable right now.');

  const ipHash = await clientIpHash();
  const count = (filter: { conversation_id?: string; client_ip_hash?: string }, windowMs: number) =>
    db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id)
      .match(filter)
      .eq('sender_type', 'customer')
      .gte('created_at', since(windowMs))
      .then(({ count: n }) => n ?? 0);
  const DAY = 24 * 60 * 60_000;
  const [visitorMinute, visitorDay, ipMinute, ipDay, history] = await Promise.all([
    count({ conversation_id: conversation.id }, 60_000),
    count({ conversation_id: conversation.id }, DAY),
    ipHash ? count({ client_ip_hash: ipHash }, 60_000) : 0,
    ipHash ? count({ client_ip_hash: ipHash }, DAY) : 0,
    recentHistory(db, conversation.id),
  ]);
  if (visitorMinute >= MAX_PER_MINUTE || ipMinute >= MAX_PER_IP_MINUTE) return fail(429, 'You are sending messages too fast. Please wait a moment.');
  if (visitorDay >= MAX_PER_DAY || ipDay >= MAX_PER_IP_DAY) return fail(429, 'Too many messages today. Please call the shop, or try again tomorrow.');

  const { data: saved, error: saveError } = await db
    .from('messages')
    .insert({
      tenant_id: tenant.id,
      conversation_id: conversation.id,
      sender_type: 'customer',
      content_type: kind,
      content_text: text || null,
      client_ip_hash: ipHash,
    })
    .select('id')
    .single();
  if (saveError) return fail(500, 'Chat is unavailable right now.');

  // Uploading and transcribing runs alongside the AI reply, so keeping the media costs the customer no extra wait.
  // Every return below awaits it: a staff-handled or AI-off chat needs the voice note in the inbox just as much.
  const persisting = mediaBytes
    ? storeMedia(db, { id: saved.id, tenantId: tenant.id, conversationId: conversation.id }, { mimeType, kind: kind as 'audio' | 'image', bytes: mediaBytes })
    : Promise.resolve();

  // AI paused for the shop or monthly allowance used: the merchant still gets the message, and the chat is
  // flagged, because the customer has just been told the team will reply and nobody else is going to.
  const aiAllowed = tenant.ai_enabled && (await withinMonthlyLimit(db, tenant));
  if (!aiAllowed) {
    if (!conversation.ai_muted) {
      await db
        .from('conversations')
        .update({
          needs_human: true,
          handoff_reason: tenant.ai_enabled ? 'AI is off: this month’s message limit is used up' : 'AI is paused for this shop',
          handoff_at: new Date().toISOString(),
        })
        .eq('id', conversation.id);
    }
    await persisting;
    return Response.json({ reply: null });
  }

  if (conversation.ai_muted) {
    const staffLastActive = Math.max(ms(conversation.taken_over_at), ms(conversation.last_staff_reply_at));
    if (Date.now() - staffLastActive < STAFF_IDLE_HANDBACK_MS) {
      await persisting;
      return Response.json({ reply: null, staff: true });
    }
    // Staff went quiet: the chat returns to the AI.
    await db.from('conversations').update({ ai_muted: false }).eq('id', conversation.id);
  }

  try {
    const [reply] = await Promise.all([
      aiReply(db, {
        tenant,
        customerId: customer.id,
        conversationId: conversation.id,
        history,
        userText: text,
        media: mediaBytes ? { mimeType, data: mediaBytes.toString('base64'), kind: kind as 'audio' | 'image' } : undefined,
      }),
      persisting,
    ]);
    return Response.json({ reply, staff: !reply });
  } catch (err) {
    await persisting;
    return agentFailed(err, tenant.id);
  }
}

// The customer's chat polls this for staff replies (visitors are anonymous, so they can't subscribe to the database).
// It also lets the AI step back in when staff took over but left the customer waiting.
export async function GET(request: Request, ctx: RouteContext<'/api/chat/[slug]'>) {
  const { slug } = await ctx.params;
  const after = new URL(request.url).searchParams.get('after');
  const db = createAdminClient();
  const tenant = await activeTenant(db, slug);
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
