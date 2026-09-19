import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireMerchant } from '@/lib/auth';
import { getLang, t } from '@/lib/i18n';
import { btn, btnDanger, btnGhost, card, input, statusBadge } from '@/components/ui';
import { dhakaTime, searchTerm, taka } from '@/lib/chat';
import { setOrderStatus } from './actions';

type OrderRow = {
  id: string;
  order_number: string;
  status: 'draft' | 'confirmed' | 'cancelled';
  total_bdt: number;
  payment_method: string;
  created_at: string;
  shipping_address: { name?: string; phone?: string; address?: string; note?: string };
  items: { title: string; quantity: number; unit_price: number }[];
};

const STATUS_LABEL = { draft: 'new', confirmed: 'active', cancelled: 'suspended' } as const;

const FILTERS = { all: 'All', draft: 'New', confirmed: 'Confirmed', cancelled: 'Cancelled' } as const;
type Filter = keyof typeof FILTERS;
const PAGE_SIZE = 20;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ f?: string; q?: string; p?: string }> }) {
  const [{ supabase, tenant }, lang] = await Promise.all([requireMerchant(), getLang()]);
  if (!tenant.onboarding_completed_at) redirect('/dashboard/onboarding');

  const { f, q, p } = await searchParams;
  const filter: Filter = f && f in FILTERS ? (f as Filter) : 'all';
  const search = searchTerm(q);
  const page = Math.max(1, Number(p) || 1);
  const from = (page - 1) * PAGE_SIZE;

  let query = supabase
    .from('orders')
    .select('id, order_number, status, total_bdt, payment_method, created_at, shipping_address, items', { count: 'exact' })
    .eq('tenant_id', tenant.id);
  if (filter !== 'all') query = query.eq('status', filter);
  if (search) query = query.or(`order_number.ilike.*${search}*,shipping_address->>phone.ilike.*${search}*`);

  const { data, count } = await query.order('created_at', { ascending: false }).range(from, from + PAGE_SIZE - 1);
  const orders = (data ?? []) as OrderRow[];
  const total = count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const href = (next: { f?: Filter; q?: string; p?: number }) => {
    const params = new URLSearchParams();
    const nextFilter = next.f ?? filter;
    const nextSearch = next.q ?? search;
    const nextPage = next.p ?? 1;
    if (nextFilter !== 'all') params.set('f', nextFilter);
    if (nextSearch) params.set('q', nextSearch);
    if (nextPage > 1) params.set('p', String(nextPage));
    const qs = params.toString();
    return `/dashboard/orders${qs ? `?${qs}` : ''}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t(lang, 'orders.title')}</h1>
        <p className="mt-1 text-sm text-zinc-500">{t(lang, 'orders.subtitle')}</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-2 text-sm">
          {(Object.keys(FILTERS) as Filter[]).map((key) => (
            <Link
              key={key}
              href={href({ f: key, p: 1 })}
              className={`rounded-full px-3 py-1 ${key === filter ? 'bg-foreground text-background' : 'bg-surface ring-1 ring-zinc-200 hover:bg-zinc-100'}`}
            >
              {FILTERS[key]}
            </Link>
          ))}
        </nav>
        <form className="flex gap-2">
          {filter !== 'all' && <input type="hidden" name="f" value={filter} />}
          <input
            name="q"
            defaultValue={search}
            className={`${input} w-56`}
            placeholder={t(lang, 'orders.search')}
            aria-label="Search orders by order number or phone"
            maxLength={60}
          />
          <button className={btnGhost}>Search</button>
        </form>
      </div>

      {orders.length === 0 ? (
        <div className={`${card} py-16 text-center`}>
          <p className="text-lg font-medium">{search || filter !== 'all' ? 'Nothing matches' : t(lang, 'orders.emptyTitle')}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500">
            {search || filter !== 'all'
              ? 'Try a different search, or clear the filter.'
              : t(lang, 'orders.emptyBody')}
          </p>
          {(search || filter !== 'all') && (
            <Link href="/dashboard/orders" className={`${btnGhost} mt-6`}>
              Show all orders
            </Link>
          )}
        </div>
      ) : (
        <ul className="space-y-4">
          {orders.map((o) => (
            <li key={o.id} className={`${card} space-y-3`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{o.order_number}</span>
                  {/* statusBadge colours: new = amber, confirmed = green, cancelled = red */}
                  <span className={statusBadge(STATUS_LABEL[o.status])}>{o.status === 'draft' ? 'new' : o.status}</span>
                </div>
                <span className="text-sm text-zinc-500">{dhakaTime(o.created_at)}</span>
              </div>

              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <p className="font-medium">{o.shipping_address.name}</p>
                  <p>
                    <a href={`tel:${o.shipping_address.phone}`} className="underline">
                      {o.shipping_address.phone}
                    </a>
                  </p>
                  <p className="text-zinc-600">{o.shipping_address.address}</p>
                  {o.shipping_address.note && <p className="text-zinc-500">Note: {o.shipping_address.note}</p>}
                </div>
                <div>
                  <ul>
                    {o.items.map((item, i) => (
                      <li key={i} className="flex justify-between gap-3">
                        <span>
                          {item.quantity} × {item.title}
                        </span>
                        <span className="tabular-nums">{taka(item.unit_price * item.quantity)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 flex justify-between border-t border-zinc-100 pt-1 font-semibold">
                    <span>Total ({o.payment_method.toUpperCase()}, excl. delivery)</span>
                    <span className="tabular-nums">{taka(o.total_bdt)}</span>
                  </p>
                </div>
              </div>

              {o.status === 'draft' && tenant.status !== 'suspended' && (
                <div className="flex gap-2">
                  <form action={setOrderStatus.bind(null, o.id, 'confirmed')}>
                    <button className={btn}>{t(lang, 'orders.confirm')}</button>
                  </form>
                  <form action={setOrderStatus.bind(null, o.id, 'cancelled')}>
                    <button className={btnDanger}>{t(lang, 'orders.cancel')}</button>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-500">
            {from + 1}–{Math.min(from + PAGE_SIZE, total)} of {total.toLocaleString()}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={href({ p: page - 1 })} className={btnGhost}>
                ← Newer
              </Link>
            )}
            {page < lastPage && (
              <Link href={href({ p: page + 1 })} className={btnGhost}>
                Older →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
