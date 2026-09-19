import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireMerchant } from '@/lib/auth';
import { MicIcon, PhotoIcon } from '@/components/icons';
import { t } from '@/lib/i18n';
import { getLang } from '@/lib/i18n-server';
import { btn, btnDanger, btnGhost, card, input } from '@/components/ui';
import { CHAT_MEDIA_BUCKET, MESSAGE_COLUMNS, dhakaTime, mediaLabel, taka, toChatLine, type MessageRow } from '@/lib/chat';
import { dismissAlert, forgetCustomer, handBack, sendStaffReply, takeOver } from './actions';

type ConversationRow = {
  id: string;
  channel: string;
  last_message_at: string;
  ai_muted: boolean;
  needs_human: boolean;
  handoff_reason: string | null;
  customers: { id: string; name: string | null; phone: string | null } | null;
};

const SIGNED_URL_TTL = 60 * 60; // an hour of reading one inbox

const FILTERS = { all: 'All', needs: 'Needs you', staff: 'Staff handling', ai: 'AI handling' } as const;
type Filter = keyof typeof FILTERS;

export default async function ChatsPage({ searchParams }: { searchParams: Promise<{ c?: string; f?: string }> }) {
  const [{ supabase, tenant }, lang] = await Promise.all([requireMerchant(), getLang()]);
  if (!tenant.onboarding_completed_at) redirect('/dashboard/onboarding');
  const { c, f } = await searchParams;
  const filter: Filter = f && f in FILTERS ? (f as Filter) : 'all';

  let query = supabase
    .from('conversations')
    .select('id, channel, last_message_at, ai_muted, needs_human, handoff_reason, customers(id, name, phone)')
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

  // Voice notes and photos live in a private bucket; staff get a link that expires with the page they're reading.
  const paths = messages.map((m) => m.media_url).filter((p): p is string => Boolean(p));
  const { data: signed } = paths.length ? await supabase.storage.from(CHAT_MEDIA_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL) : { data: [] };
  const mediaUrls = new Map((signed ?? []).filter((s) => s.path && s.signedUrl).map((s) => [s.path as string, s.signedUrl]));

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
        <h1 className="text-2xl font-semibold">{t(lang, 'chats.title')}</h1>
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
            className={`rounded-full px-3 py-1 ${key === filter ? 'bg-foreground text-background' : 'bg-surface ring-1 ring-zinc-200 hover:bg-zinc-100'}`}
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
          <ul className={`${card} max-h-[70vh] divide-y divide-line overflow-y-auto p-0 ${c ? 'hidden lg:block' : ''}`}>
            {conversations.map((conv) => (
              <li key={conv.id}>
                <Link href={href({ c: conv.id })} className={`block px-4 py-3 text-sm hover:bg-zinc-50 ${conv.id === active.id ? 'bg-zinc-100' : ''}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{who(conv)}</p>
                    {conv.needs_human ? (
                      <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-medium text-warning-strong">Needs you</span>
                    ) : conv.ai_muted ? (
                      <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-strong">Staff</span>
                    ) : null}
                  </div>
                  <p className="text-xs text-zinc-500">
                    {conv.channel} · {dhakaTime(conv.last_message_at)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>

          <section className={`${card} h-[70vh] flex-col gap-3 ${c ? 'flex' : 'hidden lg:flex'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 pb-3">
              <div>
                {/* On a phone the list and the thread take turns: tapping a chat swaps the view, this swaps it back. */}
                <Link href={href({})} className="mb-1 inline-block text-xs text-zinc-500 hover:underline lg:hidden">
                  ← All chats
                </Link>
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
                      <button className={btnGhost}>{t(lang, 'chats.handBack')}</button>
                    </form>
                  ) : (
                    <form action={takeOver.bind(null, active.id)}>
                      <button className={btn}>{t(lang, 'chats.takeOver')}</button>
                    </form>
                  )}
                </div>
              )}
            </div>

            {active.needs_human && (
              <p className="rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning-strong">
                AI asked for help: {active.handoff_reason ?? 'Customer needs a person'}
              </p>
            )}

            <div className="flex flex-1 flex-col-reverse gap-3 overflow-y-auto">
              {messages.map((m) => {
                const line = toChatLine(m);
                const fromCustomer = line.from === 'customer';
                const mediaUrl = line.mediaPath ? mediaUrls.get(line.mediaPath) : undefined;
                const tone = fromCustomer ? 'bg-zinc-100' : line.from === 'agent' ? 'bg-accent text-accent-foreground' : 'bg-foreground text-background';
                return (
                  <div key={line.id} className={`flex ${fromCustomer ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[85%] rounded-card px-3.5 py-2 text-sm ${tone}`}>
                      {!fromCustomer && (
                        <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{line.from === 'agent' ? 'Team' : 'AI'}</p>
                      )}
                      {line.kind === 'audio' && mediaUrl && <audio controls preload="none" src={mediaUrl} className="mb-1 max-w-full" />}
                      {line.kind === 'image' && mediaUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={mediaUrl} alt={line.mediaNote || 'Photo the customer sent'} className="mb-1 max-h-48 rounded-chip" />
                      )}
                      {line.kind !== 'text' && !mediaUrl && (
                        <p className="flex items-center gap-1.5 opacity-70">
                          {line.kind === 'audio' ? <MicIcon size={14} /> : <PhotoIcon size={14} />}
                          {mediaLabel(line.kind)}
                        </p>
                      )}
                      {line.mediaNote && <p className="text-xs italic opacity-70">{line.mediaNote}</p>}
                      {line.text && <p className="whitespace-pre-wrap">{line.text}</p>}
                      {line.products.length > 0 && (
                        <p className="mt-1 text-xs opacity-80">Showed: {line.products.map((p) => `${p.title} (${taka(p.price)})`).join(', ')}</p>
                      )}
                      {line.orderNumber && <p className="mt-1 text-xs font-semibold text-accent-soft">Order {line.orderNumber} placed</p>}
                      <p className="mt-1 text-[10px] opacity-60">{dhakaTime(m.created_at)}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {canWrite && (
              <div className="space-y-2 border-t border-zinc-100 pt-3">
                <form action={sendStaffReply.bind(null, active.id)} className="flex gap-2">
                  <input
                    name="text"
                    className={input}
                    placeholder={active.ai_muted ? 'Reply to the customer…' : 'Reply to the customer (this pauses the AI)…'}
                    required
                    maxLength={2000}
                    autoComplete="off"
                    aria-label="Reply to the customer"
                  />
                  <button className={btn}>{t(lang, 'chats.send')}</button>
                </form>

                {/* Two steps, no JavaScript: the delete button only exists once the merchant opens the disclosure. */}
                {active.customers?.id && (
                  <details className="text-xs text-zinc-500">
                    <summary className="cursor-pointer select-none hover:text-zinc-900">Customer asked to be forgotten?</summary>
                    <div className="mt-2 space-y-2 rounded-control border border-danger/25 bg-danger-soft p-3">
                      <p className="text-danger-strong">
                        Deletes this chat, its voice notes and photos, and the customer&apos;s name and number. Their orders stay, without personal
                        details. This cannot be undone.
                      </p>
                      <form action={forgetCustomer.bind(null, active.customers.id)}>
                        <button className={btnDanger}>Delete this customer&apos;s data</button>
                      </form>
                    </div>
                  </details>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
