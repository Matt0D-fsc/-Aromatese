import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { runAgent, type AgentInput } from '@/lib/agent';
import { storeMedia } from '@/lib/media';
import { auditError } from '@/lib/audit';
import { MESSAGE_COLUMNS, VISITOR_COOKIE, toChatLine, type ChatLine, type MessageRow } from '@/lib/chat';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT = 2000;
const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
const MAX_PER_MINUTE = 8;
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
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { count } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id)
    .gte('created_at', monthStart.toISOString());
  return (count ?? 0) < tenant.monthly_message_limit;
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

// Customer sends a message. Public endpoint: anyone with the shop's chat link can talk to its agent.
// AI cost is capped per shop by monthly_message_limit and per visitor by MAX_PER_MINUTE.
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

  const [{ count: recentCount }, history] = await Promise.all([
    db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversation.id)
      .eq('sender_type', 'customer')
      .gte('created_at', new Date(Date.now() - 60_000).toISOString()),
    recentHistory(db, conversation.id),
  ]);
  if ((recentCount ?? 0) >= MAX_PER_MINUTE) return fail(429, 'You are sending messages too fast. Please wait a moment.');

  const { data: saved, error: saveError } = await db
    .from('messages')
    .insert({
      tenant_id: tenant.id,
      conversation_id: conversation.id,
      sender_type: 'customer',
      content_type: kind,
      content_text: text || null,
    })
    .select('id')
    .single();
  if (saveError) return fail(500, 'Chat is unavailable right now.');

  // Uploading and transcribing runs alongside the AI reply, so keeping the media costs the customer no extra wait.
  // Every return below awaits it: a staff-handled or AI-off chat needs the voice note in the inbox just as much.
  const persisting = mediaBytes
    ? storeMedia(db, { id: saved.id, tenantId: tenant.id, conversationId: conversation.id }, { mimeType, kind: kind as 'audio' | 'image', bytes: mediaBytes })
    : Promise.resolve();

  // AI paused for the shop or monthly allowance used: the merchant still gets the message.
  if (!tenant.ai_enabled || !(await withinMonthlyLimit(db, tenant))) {
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
