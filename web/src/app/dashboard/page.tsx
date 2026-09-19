import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireMerchant } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { getLang } from '@/lib/i18n-server';
import { btn, btnGhost, card } from '@/components/ui';
import { dhakaTime, taka } from '@/lib/chat';
import { BellIcon, ChevronRightIcon, PhoneIcon, SearchIcon } from '@/components/icons';
import { setOrderStatus } from './orders/actions';

// What a merchant opens ChatNab to do: answer whoever is waiting, and confirm what sold. Until now the first
// screen was the product list — the one thing they filled in once and rarely need again.

type NeedsRow = { id: string; handoff_reason: string | null; last_message_at: string; customers: { name: string | null; phone: string | null } | null };
type OrderRow = {
  id: string;
  order_number: string;
  total_bdt: number;
  created_at: string;
  shipping_address: { name?: string; phone?: string; address?: string };
  items: { title: string; quantity: number }[];
};
type DailyRow = { chats: number; orders: number; revenue: number };
type UnmatchedRow = { query: string; times: number };

const NEW_ORDERS = 3;
// en-CA formats as YYYY-MM-DD, the same shape the view's day column comes back in.
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());

export default async function HomePage() {
  const [{ supabase, tenant }, lang] = await Promise.all([requireMerchant(), getLang()]);
  if (!tenant.onboarding_completed_at) redirect('/dashboard/onboarding');

  const day = today();
  const [{ data: needsRows }, { data: orderRows }, { data: dailyRow }, { data: unmatchedRows }] = await Promise.all([
    supabase
      .from('conversations')
      .select('id, handoff_reason, last_message_at, customers(name, phone)')
      .eq('tenant_id', tenant.id)
      .eq('needs_human', true)
      .order('last_message_at', { ascending: false })
      .limit(3),
    supabase
      .from('orders')
      .select('id, order_number, total_bdt, created_at, shipping_address, items')
      .eq('tenant_id', tenant.id)
      .eq('status', 'draft')
      .order('created_at', { ascending: false })
      .limit(NEW_ORDERS),
    supabase.from('tenant_daily_stats').select('chats, orders, revenue').eq('tenant_id', tenant.id).eq('day', day).maybeSingle(),
    supabase.from('tenant_unmatched_searches_30d').select('query, times').eq('tenant_id', tenant.id).order('times', { ascending: false }).limit(1),
  ]);

  const needs = (needsRows ?? []) as unknown as NeedsRow[];
  const orders = (orderRows ?? []) as OrderRow[];
  const stats = (dailyRow ?? { chats: 0, orders: 0, revenue: 0 }) as DailyRow;
  const missed = ((unmatchedRows ?? []) as UnmatchedRow[])[0];
  const canWrite = tenant.status !== 'suspended';
  const who = (row: NeedsRow) => row.customers?.name || row.customers?.phone || 'A visitor';

  return (
    <div className="space-y-6">
      <h1 className="sr-only">{t(lang, 'nav.home')}</h1>

      {needs.length > 0 ? (
        <Link
          href="/dashboard/chats?f=needs"
          className="flex items-center gap-3 rounded-card border border-warning/30 bg-warning-soft p-4 transition-colors duration-150 hover:bg-warning/15"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-surface text-warning">
            <BellIcon size={21} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-warning-strong">
              {needs.length === 1 ? '1 customer needs you' : `${needs.length} customers need you`}
            </span>
            <span className="mt-0.5 block truncate text-sm text-warning-strong/85">
              {who(needs[0])}
              {needs[0].handoff_reason ? ` · ${needs[0].handoff_reason}` : ''}
            </span>
          </span>
          <ChevronRightIcon size={19} className="shrink-0 text-warning" />
        </Link>
      ) : (
        <div className="rounded-card border border-line bg-surface p-4 text-sm text-zinc-500">
          Nobody is waiting on you. The AI is handling every open chat.
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">New orders</h2>
          <Link href="/dashboard/orders" className="text-sm font-medium text-zinc-500 hover:text-foreground">
            All orders
          </Link>
        </div>

        {orders.length === 0 ? (
          <div className={`${card} py-10 text-center`}>
            <p className="font-medium">No orders waiting</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-zinc-500">
              When a customer agrees to buy in chat, the AI takes their details and the order lands here to confirm.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {orders.map((o) => (
              <li key={o.id} className={`${card} space-y-3 p-4`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{o.shipping_address?.name || o.order_number}</p>
                    <p className="mt-0.5 truncate text-sm text-zinc-500">
                      {o.items.map((i) => `${i.quantity} × ${i.title}`).join(', ')}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {o.shipping_address?.address ?? 'No address'} · {dhakaTime(o.created_at)}
                    </p>
                  </div>
                  <span className="shrink-0 text-lg font-bold tabular-nums">{taka(o.total_bdt)}</span>
                </div>

                {canWrite && (
                  <div className="flex gap-2">
                    {o.shipping_address?.phone && (
                      <a href={`tel:${o.shipping_address.phone}`} className={`${btnGhost} flex-1`}>
                        <PhoneIcon size={17} />
                        Call
                      </a>
                    )}
                    {/* Confirming moves stock, so it stays a real form post rather than an optimistic tap. */}
                    <form action={setOrderStatus.bind(null, o.id, 'confirmed')} className="flex-1">
                      <button className={`${btn} w-full`}>Confirm</button>
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">Today</h2>
          <span className="text-sm text-zinc-500">since midnight in Dhaka</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className={`${card} p-4`}>
            <p className="text-2xl font-bold tabular-nums">{Number(stats.chats).toLocaleString()}</p>
            <p className="mt-0.5 text-sm text-zinc-500">chats</p>
          </div>
          <div className={`${card} p-4`}>
            <p className="text-2xl font-bold tabular-nums">{Number(stats.orders).toLocaleString()}</p>
            <p className="mt-0.5 text-sm text-zinc-500">orders</p>
          </div>
          <div className="rounded-card bg-zinc-900 p-4 text-zinc-50">
            <p className="text-2xl font-bold tabular-nums">{taka(Number(stats.revenue))}</p>
            <p className="mt-0.5 text-sm text-zinc-400">order value</p>
          </div>
        </div>
      </section>

      {missed && (
        <Link href="/dashboard/analytics" className={`${card} flex items-center gap-3 p-4 transition-colors duration-150 hover:bg-content2`}>
          <SearchIcon size={19} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">
              {missed.times === 1 ? 'Someone asked' : `${missed.times} people asked`} for &ldquo;{missed.query}&rdquo;
            </span>
            <span className="mt-0.5 block text-sm text-zinc-500">You do not sell it yet</span>
          </span>
          <ChevronRightIcon size={18} className="shrink-0 text-zinc-400" />
        </Link>
      )}

      {/* The tab bar holds the five daily places. Everything else is reachable from here, so nothing is
          stranded on a phone. */}
      <section className={`${card} divide-y divide-line p-0 sm:hidden`}>
        {[
          ['/dashboard/customers', t(lang, 'nav.customers')],
          ['/dashboard/ai', t(lang, 'nav.ai')],
          ['/dashboard/staff', t(lang, 'nav.team')],
          ['/dashboard/onboarding', t(lang, 'nav.profile')],
          [`/chat/${tenant.slug}`, t(lang, 'nav.openChat')],
        ].map(([href, text]) => (
          <Link
            key={href}
            href={href}
            {...(href.startsWith('/chat/') ? { target: '_blank' } : {})}
            className="flex min-h-14 items-center gap-3 px-4 text-sm font-medium"
          >
            <span className="flex-1">{text}</span>
            <ChevronRightIcon size={18} className="shrink-0 text-zinc-400" />
          </Link>
        ))}
      </section>
    </div>
  );
}
