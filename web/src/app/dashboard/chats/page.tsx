import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireMerchant } from '@/lib/auth';
import { btn, btnGhost, card, input } from '@/components/ui';
import { MESSAGE_COLUMNS, dhakaTime, mediaLabel, taka, toChatLine, type MessageRow } from '@/lib/chat';
import { dismissAlert, handBack, sendStaffReply, takeOver } from './actions';

type ConversationRow = {
  id: string;
  channel: string;
  last_message_at: string;
  ai_muted: boolean;
  needs_human: boolean;
  handoff_reason: string | null;
  customers: { name: string | null; phone: string | null } | null;
};

const FILTERS = { all: 'All', needs: 'Needs you', staff: 'Staff handling', ai: 'AI handling' } as const;
type Filter = keyof typeof FILTERS;

export default async function ChatsPage({ searchParams }: { searchParams: Promise<{ c?: string; f?: string }> }) {
  const { supabase, tenant } = await requireMerchant();
  if (!tenant.onboarding_completed_at) redirect('/dashboard/onboarding');
  const { c, f } = await searchParams;
  const filter: Filter = f && f in FILTERS ? (f as Filter) : 'all';

  let query = supabase
    .from('conversations')
    .select('id, channel, last_message_at, ai_muted, needs_human, handoff_reason, customers(name, phone)')
    .eq('tenant_id', tenant.id);
  if (filter === 'needs') query = query.eq('needs_human', true);
  if (filter === 'staff') query = query.eq('ai_muted', true);
  if (filter === 'ai') query = query.eq('ai_muted', false);
  const { data } = await query.order('needs_human', { ascending: false }).order('last_message_at', { ascending: false }).limit(50);
  const conversations = (data ?? []) as unknown as ConversationRow[];
  const active = conversations.find((x) => x.id === c) ?? conversations[0];

  // Newest first, drawn bottom-up (flex-col-reverse) so the thread opens at the latest message.
  // ponytail: latest 200 messages per thread; add "load older" when chats get that long.
  const { data: rows } = active
    ? await supabase.from('messages').select(MESSAGE_COLUMNS).eq('conversation_id', active.id).order('created_at', { ascending: false }).limit(200)
    : { data: [] };
  const messages = (rows ?? []) as MessageRow[];

  const canWrite = tenant.status !== 'suspended';
  const who = (conv: ConversationRow) => conv.customers?.name || conv.customers?.phone || `Visitor ${conv.id.slice(0, 6)}`;
  const href = (next: { c?: string; f?: Filter }) => {
    const params = new URLSearchParams();
    const nextFilter = next.f ?? filter;
    if (nextFilter !== 'all') params.set('f', nextFilter);
    if (next.c) params.set('c', next.c);
    const qs = params.toString();
    return `/dashboard/chats${qs ? `?${qs}` : ''}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Chats</h1>
        <p className="mt-1 text-sm text-zinc-500">
          The AI handles chats until you take over, and asks for you when a customer needs a person.{' '}
          <Link href={`/chat/${tenant.slug}`} target="_blank" className="font-medium text-zinc-900 underline">
            Open your chat link ↗
          </Link>
        </p>
      </div>

      <nav className="flex flex-wrap gap-2 text-sm">
        {(Object.keys(FILTERS) as Filter[]).map((key) => (
          <Link
            key={key}
            href={href({ f: key })}
            className={`rounded-full px-3 py-1 ${key === filter ? 'bg-zinc-900 text-white' : 'bg-white ring-1 ring-zinc-200 hover:bg-zinc-100'}`}
          >
            {FILTERS[key]}
          </Link>
        ))}
      </nav>

      {!active ? (
        <div className={`${card} py-16 text-center`}>
          <p className="text-lg font-medium">{filter === 'all' ? 'No chats yet' : `Nothing in "${FILTERS[filter]}"`}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500">Share your chat link with customers, or open it yourself to test the AI.</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <ul className={`${card} max-h-[70vh] divide-y divide-zinc-100 overflow-y-auto p-0`}>
            {conversations.map((conv) => (
              <li key={conv.id}>
                <Link href={href({ c: conv.id })} className={`block px-4 py-3 text-sm hover:bg-zinc-50 ${conv.id === active.id ? 'bg-zinc-100' : ''}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{who(conv)}</p>
                    {conv.needs_human ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">Needs you</span>
                    ) : conv.ai_muted ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">Staff</span>
                    ) : null}
                  </div>
                  <p className="text-xs text-zinc-500">
                    {conv.channel} · {dhakaTime(conv.last_message_at)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>

          <section className={`${card} flex h-[70vh] flex-col gap-3`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 pb-3">
              <div>
                <p className="font-medium">
                  {who(active)} {active.customers?.phone && <span className="text-sm font-normal text-zinc-500">· {active.customers.phone}</span>}
                </p>
                <p className="text-xs text-zinc-500">
                  {active.ai_muted ? 'You are handling this chat. The AI is paused.' : 'The AI is handling this chat.'}
                </p>
              </div>
              {canWrite && (
                <div className="flex gap-2">
                  {active.needs_human && !active.ai_muted && (
                    <form action={dismissAlert.bind(null, active.id)}>
                      <button className={btnGhost}>Dismiss</button>
                    </form>
                  )}
                  {active.ai_muted ? (
                    <form action={handBack.bind(null, active.id)}>
                      <button className={btnGhost}>Hand back to AI</button>
                    </form>
                  ) : (
                    <form action={takeOver.bind(null, active.id)}>
                      <button className={btn}>Take over</button>
                    </form>
                  )}
                </div>
              )}
            </div>

            {active.needs_human && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                AI asked for help: {active.handoff_reason ?? 'Customer needs a person'}
              </p>
            )}

            <div className="flex flex-1 flex-col-reverse gap-3 overflow-y-auto">
              {messages.map((m) => {
                const line = toChatLine(m);
                const fromCustomer = line.from === 'customer';
                const tone = fromCustomer ? 'bg-zinc-100' : line.from === 'agent' ? 'bg-emerald-700 text-white' : 'bg-zinc-900 text-white';
                return (
                  <div key={line.id} className={`flex ${fromCustomer ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${tone}`}>
                      {!fromCustomer && (
                        <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{line.from === 'agent' ? 'Team' : 'AI'}</p>
                      )}
                      {line.kind !== 'text' && <p className="opacity-70">{mediaLabel(line.kind)}</p>}
                      {line.text && <p className="whitespace-pre-wrap">{line.text}</p>}
                      {line.products.length > 0 && (
                        <p className="mt-1 text-xs opacity-80">Showed: {line.products.map((p) => `${p.title} (${taka(p.price)})`).join(', ')}</p>
                      )}
                      {line.orderNumber && <p className="mt-1 text-xs font-semibold text-emerald-300">Order {line.orderNumber} placed</p>}
                      <p className="mt-1 text-[10px] opacity-60">{dhakaTime(m.created_at)}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {canWrite && (
              <form action={sendStaffReply.bind(null, active.id)} className="flex gap-2 border-t border-zinc-100 pt-3">
                <input
                  name="text"
                  className={input}
                  placeholder={active.ai_muted ? 'Reply to the customer…' : 'Reply to the customer (this pauses the AI)…'}
                  required
                  maxLength={2000}
                  autoComplete="off"
                  aria-label="Reply to the customer"
                />
                <button className={btn}>Send</button>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
