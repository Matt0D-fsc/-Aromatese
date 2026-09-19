import { createAdminClient } from '@/lib/supabase/admin';
import { runAgent, type AgentInput } from '@/lib/agent';
import { storeMedia, type IncomingMedia } from '@/lib/media';
import { audit } from '@/lib/audit';
import { monthStart, usageLevel } from '@/lib/usage';
import { MESSAGE_COLUMNS, toChatLine, type ChatLine, type MessageRow } from '@/lib/chat';

// One customer message arriving at one shop, whatever carried it here. The web chat widget and the Meta
// webhook both end up in handleInbound: it decides whether the AI may answer, whether staff has the chat,
// saves what was said and returns the reply.
//
// Transport-agnostic on purpose — nothing here knows about HTTP status codes, cookies or Meta's Send API.
// Getting the reply to the customer is the caller's job, because a web visitor reads it in the response and
// a Messenger customer needs it pushed back through Meta.

export type InboundTenant = {
  id: string;
  name: string;
  business_category: string | null;
  status: string;
  ai_enabled: boolean;
  monthly_message_limit: number;
  policies: unknown;
  ai_playbook: unknown;
};

export type InboundChannel = 'web' | 'messenger' | 'instagram';

export type Inbound = {
  tenant: InboundTenant;
  channel: InboundChannel;
  /** Who the customer is on this channel: the visitor cookie on web, the PSID/IGSID on Meta. */
  channelUserId: string;
  text: string;
  media?: IncomingMedia;
  /** Web only. Salted hash used for the per-connection flood limits. */
  ipHash?: string | null;
  /** Meta only. Its message id, which makes a retried delivery a duplicate instead of a second message. */
  platformMessageId?: string | null;
};

export type InboundResult = {
  reply: ChatLine | null;
  /** True when a person has the conversation, so no AI reply was written. */
  staff: boolean;
  conversationId: string;
  /** True when this exact platform message was already handled; nothing was saved or answered. */
  duplicate?: boolean;
};

/** A reason the message cannot be handled, carrying the status the web chat should answer with. */
export class InboundError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'InboundError';
  }
}

export const TENANT_COLUMNS = 'id, name, business_category, status, ai_enabled, monthly_message_limit, policies, ai_playbook';
export const CONVERSATION_COLUMNS = 'id, ai_muted, taken_over_at, last_staff_reply_at';

const MAX_PER_MINUTE = 8;
const MAX_PER_DAY = 150; // one visitor, one shop
// Per connection, across every visitor behind it. Generous on purpose: Bangladeshi mobile networks put many
// customers behind one shared IP (carrier NAT), and a real shop's customers must never be blocked by each other.
const MAX_PER_IP_MINUTE = 40;
const MAX_PER_IP_DAY = 400;
const HISTORY_MESSAGES = 20;
export const STAFF_REPLY_TIMEOUT_MS = 5 * 60_000; // customer left waiting on staff this long -> the AI steps back in
const STAFF_IDLE_HANDBACK_MS = 30 * 60_000; // staff silent this long -> the next customer message goes to the AI

// Postgres unique violation: the message id came in twice, which is Meta retrying a delivery it already made.
const UNIQUE_VIOLATION = '23505';

type Db = ReturnType<typeof createAdminClient>;

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : 0);
const since = (windowMs: number) => new Date(Date.now() - windowMs).toISOString();

export async function tenantBySlug(db: Db, slug: string) {
  const { data } = await db.from('tenants').select(TENANT_COLUMNS).eq('slug', slug).maybeSingle();
  return data?.status === 'active' ? (data as InboundTenant) : null;
}

export async function tenantById(db: Db, id: string) {
  const { data } = await db.from('tenants').select(TENANT_COLUMNS).eq('id', id).maybeSingle();
  return data?.status === 'active' ? (data as InboundTenant) : null;
}

export async function withinMonthlyLimit(db: Db, tenant: InboundTenant) {
  const start = monthStart().toISOString();
  const { count } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id)
    .eq('sender_type', 'bot') // the limit caps the AI's replies; customers and staff are free
    .gte('created_at', start);
  const used = count ?? 0;
  const level = usageLevel(used, tenant.monthly_message_limit);
  // Once per shop per month for each level, so the admin activity feed shows it without repeating it on every
  // message. Never delays the reply.
  if (level !== 'ok') void alertOnce(db, tenant.id, level === 'out' ? 'usage.limit_reached' : 'usage.limit_warning', start, { used, limit: tenant.monthly_message_limit });
  return level !== 'out';
}

// ponytail: check-then-insert can record twice if two messages cross the line at once; a duplicate feed row is harmless.
async function alertOnce(db: Db, tenantId: string, event: string, start: string, detail: Record<string, unknown>) {
  const { count } = await db.from('audit_logs').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('event_type', event).gte('created_at', start);
  if (!count) await audit(event, { tenantId, detail });
}

export async function recentHistory(db: Db, conversationId: string) {
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
export async function aiReply(db: Db, input: AgentInput): Promise<ChatLine | null> {
  // The admin's persona lives in its own service-role-only table (migration 018), never on the tenant row.
  const { data: persona } = await db.from('tenant_ai_persona').select('persona').eq('tenant_id', input.tenant.id).maybeSingle();
  const result = await runAgent({ ...input, tenant: { ...input.tenant, ai_persona: persona?.persona } });

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

/**
 * Save a customer's message and answer it. Throws InboundError when the shop cannot take the message at all
 * (flooding, or the database refusing); every other outcome is a normal result the caller reads.
 */
export async function handleInbound(db: Db, inbound: Inbound): Promise<InboundResult> {
  const { tenant, channel, channelUserId } = inbound;

  const { data: customer, error: customerError } = await db
    .from('customers')
    .upsert({ tenant_id: tenant.id, channel, channel_user_id: channelUserId }, { onConflict: 'tenant_id,channel,channel_user_id' })
    .select('id')
    .single();
  if (customerError) throw new InboundError(500, 'Chat is unavailable right now.');

  const { data: conversation, error: conversationError } = await db
    .from('conversations')
    .upsert(
      { tenant_id: tenant.id, customer_id: customer.id, channel, last_message_at: new Date().toISOString() },
      { onConflict: 'tenant_id,customer_id,channel' },
    )
    .select(CONVERSATION_COLUMNS)
    .single();
  if (conversationError) throw new InboundError(500, 'Chat is unavailable right now.');

  const ipHash = inbound.ipHash ?? null;
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
  if (visitorMinute >= MAX_PER_MINUTE || ipMinute >= MAX_PER_IP_MINUTE) throw new InboundError(429, 'You are sending messages too fast. Please wait a moment.');
  if (visitorDay >= MAX_PER_DAY || ipDay >= MAX_PER_IP_DAY) throw new InboundError(429, 'Too many messages today. Please call the shop, or try again tomorrow.');

  const kind: MessageRow['content_type'] = inbound.media?.kind ?? 'text';
  const { data: saved, error: saveError } = await db
    .from('messages')
    .insert({
      tenant_id: tenant.id,
      conversation_id: conversation.id,
      sender_type: 'customer',
      content_type: kind,
      content_text: inbound.text || null,
      client_ip_hash: ipHash,
      platform_message_id: inbound.platformMessageId ?? null,
    })
    .select('id')
    .single();
  // The unique index on (tenant_id, platform_message_id) is the deduplication, not a lookup before the insert:
  // Meta can have two retries of the same delivery in flight at once, and both would pass a check.
  if (saveError?.code === UNIQUE_VIOLATION) return { reply: null, staff: false, conversationId: conversation.id, duplicate: true };
  if (saveError) throw new InboundError(500, 'Chat is unavailable right now.');

  // Uploading and transcribing runs alongside the AI reply, so keeping the media costs the customer no extra wait.
  // Every return below awaits it: a staff-handled or AI-off chat needs the voice note in the inbox just as much.
  const persisting = inbound.media
    ? storeMedia(db, { id: saved.id, tenantId: tenant.id, conversationId: conversation.id }, inbound.media)
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
    return { reply: null, staff: false, conversationId: conversation.id };
  }

  if (conversation.ai_muted) {
    const staffLastActive = Math.max(ms(conversation.taken_over_at), ms(conversation.last_staff_reply_at));
    if (Date.now() - staffLastActive < STAFF_IDLE_HANDBACK_MS) {
      await persisting;
      return { reply: null, staff: true, conversationId: conversation.id };
    }
    // Staff went quiet: the chat returns to the AI.
    await db.from('conversations').update({ ai_muted: false }).eq('id', conversation.id);
  }

  const [reply] = await Promise.all([
    aiReply(db, {
      tenant,
      customerId: customer.id,
      conversationId: conversation.id,
      history,
      userText: inbound.text,
      media: inbound.media ? { mimeType: inbound.media.mimeType, data: inbound.media.bytes.toString('base64'), kind: inbound.media.kind } : undefined,
    }),
    persisting,
  ]).catch(async (err) => {
    await persisting;
    throw err;
  });
  return { reply, staff: !reply, conversationId: conversation.id };
}
