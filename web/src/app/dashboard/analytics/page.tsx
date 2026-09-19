import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireMerchant } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { getLang } from '@/lib/i18n-server';
import { btnGhost, card } from '@/components/ui';
import { dhakaTime, taka } from '@/lib/chat';

// What the shop's month actually looked like. Every number comes from the views added in migration 011, which
// are security_invoker, so a merchant only ever sees their own rows.

type DailyRow = { day: string; chats: number; orders: number; revenue: number; ai_messages: number; staff_messages: number };
type TopProduct = { product_id: string; title: string; times_shown: number };
type Unmatched = { query: string; times: number; last_asked: string };

const DAYS = 30;
// en-CA formats as YYYY-MM-DD, the same shape Postgres returns a date in, so the two compare directly.
const dhakaDay = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(date);
// Reading the clock is kept out of the component body: this page renders per request on the server, but the
// React lint rules treat a component that calls Date.now() as impure.
const windowStart = () => dhakaDay(new Date(Date.now() - (DAYS - 1) * 86_400_000));

export default async function AnalyticsPage() {
  const [{ supabase, tenant }, lang] = await Promise.all([requireMerchant(), getLang()]);
  if (!tenant.onboarding_completed_at) redirect('/dashboard/onboarding');

  const since = windowStart();
  const [{ data: dailyData }, { data: productData }, { data: searchData }] = await Promise.all([
    supabase
      .from('tenant_daily_stats')
      .select('day, chats, orders, revenue, ai_messages, staff_messages')
      .eq('tenant_id', tenant.id)
      .gte('day', since)
      .order('day'),
    supabase.from('tenant_top_products_30d').select('product_id, title, times_shown').eq('tenant_id', tenant.id).order('times_shown', { ascending: false }).limit(8),
    supabase.from('tenant_unmatched_searches_30d').select('query, times, last_asked').eq('tenant_id', tenant.id).order('times', { ascending: false }).limit(10),
  ]);

  const daily = (dailyData ?? []) as DailyRow[];
  const topProducts = (productData ?? []) as TopProduct[];
  const unmatched = (searchData ?? []) as Unmatched[];

  const total = daily.reduce(
    (t, d) => ({
      chats: t.chats + Number(d.chats),
      orders: t.orders + Number(d.orders),
      revenue: t.revenue + Number(d.revenue),
      ai: t.ai + Number(d.ai_messages),
      staff: t.staff + Number(d.staff_messages),
    }),
    { chats: 0, orders: 0, revenue: 0, ai: 0, staff: 0 },
  );
  const conversion = total.chats ? Math.round((total.orders / total.chats) * 100) : 0;
  const handled = total.ai + total.staff;
  const busiest = Math.max(1, ...daily.map((d) => Number(d.chats)));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t(lang, 'analytics.title')}</h1>
        <p className="mt-1 text-sm text-zinc-500">The last {DAYS} days, counted in Dhaka time.</p>
      </div>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          ['Chats', total.chats.toLocaleString(), 'Customers who started a conversation'],
          ['Orders', total.orders.toLocaleString(), 'Placed by the AI in chat'],
          ['Turned into orders', `${conversion}%`, 'Of the chats that started'],
          ['Order value', taka(total.revenue), 'Excluding cancelled orders'],
        ].map(([name, value, note]) => (
          <div key={name} className={card}>
            <p className="text-xs uppercase tracking-wide text-zinc-500">{name}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
            <p className="mt-1 text-xs text-zinc-400">{note}</p>
          </div>
        ))}
      </section>

      <section className={card}>
        <h2 className="mb-4 text-base font-semibold">Chats and orders by day</h2>
        {daily.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">No activity yet. Share your chat link to get started.</p>
        ) : (
          <ul className="space-y-1">
            {daily.map((d) => (
              <li key={d.day} className="flex items-center gap-3 text-xs">
                <span className="w-14 shrink-0 text-zinc-500">{d.day.slice(5)}</span>
                <span className="flex h-4 flex-1 items-center gap-2">
                  {/* Plain divs, no chart library: two numbers a day do not need one. */}
                  <span className="h-2 rounded-sm bg-zinc-900" style={{ width: `${(Number(d.chats) / busiest) * 100}%` }} aria-hidden />
                  <span className="tabular-nums text-zinc-500">{d.chats}</span>
                  {Number(d.orders) > 0 && <span className="rounded-chip bg-accent-soft px-1.5 py-0.5 font-medium text-accent-strong">{d.orders} ordered</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card}>
          <h2 className="mb-1 text-base font-semibold">Asked for, not in your shop</h2>
          <p className="mb-4 text-sm text-zinc-500">Searches that found nothing — what customers wanted and you could not sell them.</p>
          {unmatched.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">Nothing yet. Every search has found something.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {unmatched.map((u) => (
                <li key={u.query} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="font-medium">{u.query}</span>
                  <span className="shrink-0 text-xs text-zinc-500">
                    {u.times}× · last {dhakaTime(u.last_asked)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={card}>
          <h2 className="mb-1 text-base font-semibold">Products the AI showed most</h2>
          <p className="mb-4 text-sm text-zinc-500">How often each product appeared as a card in a chat.</p>
          {topProducts.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">No products have been shown yet.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {topProducts.map((p) => (
                <li key={p.product_id} className="flex items-baseline justify-between gap-3 py-2">
                  <Link href={`/dashboard/products/${p.product_id}`} className="font-medium hover:underline">
                    {p.title}
                  </Link>
                  <span className="shrink-0 text-xs text-zinc-500">{p.times_shown}×</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className={card}>
        <h2 className="mb-1 text-base font-semibold">Download your data</h2>
        <p className="mb-4 text-sm text-zinc-500">
          Everything as a spreadsheet, for your accountant, your courier, or to keep. Opens in Excel with Bangla text intact.
        </p>
        <div className="flex flex-wrap gap-2">
          {[
            ['products', 'Products'],
            ['orders', 'Orders'],
            ['customers', 'Customers'],
          ].map(([set, label]) => (
            <a key={set} href={`/dashboard/export?set=${set}`} className={btnGhost} download>
              {label} CSV
            </a>
          ))}
        </div>
      </section>

      <section className={card}>
        <h2 className="mb-1 text-base font-semibold">Who answered</h2>
        <p className="mb-4 text-sm text-zinc-500">Replies sent by your AI compared with replies typed by your team.</p>
        {handled === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">No replies yet.</p>
        ) : (
          <>
            <div className="flex h-3 overflow-hidden rounded-full bg-zinc-100">
              <div className="bg-zinc-900" style={{ width: `${(total.ai / handled) * 100}%` }} aria-hidden />
              <div className="bg-accent" style={{ width: `${(total.staff / handled) * 100}%` }} aria-hidden />
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-sm text-zinc-600">
              <span>
                <span className="mr-1 inline-block h-2 w-2 rounded-full bg-zinc-900" />
                AI {total.ai.toLocaleString()} ({Math.round((total.ai / handled) * 100)}%)
              </span>
              <span>
                <span className="mr-1 inline-block h-2 w-2 rounded-full bg-accent" />
                Your team {total.staff.toLocaleString()}
              </span>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
