import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireMerchant } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { getLang } from '@/lib/i18n-server';
import { searchTerm } from '@/lib/chat';
import { btn, btnGhost, card, input } from '@/components/ui';
import type { ProductRow } from './product-input';
import { updateStock } from './actions';

// The same "only a few left" line the AI uses when it tells a customer stock is low.
const LOW_STOCK = 3;
const PAGE_SIZE = 48;
const FILTERS = { all: 'All', low: `Low (${LOW_STOCK} or fewer)`, out: 'Out of stock', hidden: 'Hidden' } as const;
type Filter = keyof typeof FILTERS;
type ListRow = ProductRow & { variants: { count: number }[] };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; f?: string; p?: string }> }) {
  const [{ supabase, tenant }, lang] = await Promise.all([requireMerchant(), getLang()]);
  if (!tenant.onboarding_completed_at) redirect('/dashboard/onboarding');

  const { q, f, p } = await searchParams;
  const search = searchTerm(q);
  const filter: Filter = f && f in FILTERS ? (f as Filter) : 'all';
  const page = Math.max(1, Number(p) || 1);
  const from = (page - 1) * PAGE_SIZE;

  let query = supabase
    .from('products')
    .select('id, sku, title_en, title_bn, price_bdt, discount_price_bdt, stock_quantity, is_active, image_urls, variants(count)', { count: 'exact' })
    .eq('tenant_id', tenant.id);
  if (search) query = query.or(`title_en.ilike.*${search}*,title_bn.ilike.*${search}*,title_banglish.ilike.*${search}*,sku.ilike.*${search}*`);
  if (filter === 'low') query = query.gt('stock_quantity', 0).lte('stock_quantity', LOW_STOCK);
  if (filter === 'out') query = query.eq('stock_quantity', 0);
  if (filter === 'hidden') query = query.eq('is_active', false);

  const { data, count } = await query.order('created_at', { ascending: false }).range(from, from + PAGE_SIZE - 1);
  const products = (data ?? []) as unknown as ListRow[];
  const total = count ?? 0;
  const narrowed = Boolean(search) || filter !== 'all';
  const canWrite = tenant.status !== 'suspended';

  const href = (next: { f?: Filter; p?: number }) => {
    const params = new URLSearchParams();
    const nextFilter = next.f ?? filter;
    if (search) params.set('q', search);
    if (nextFilter !== 'all') params.set('f', nextFilter);
    if ((next.p ?? 1) > 1) params.set('p', String(next.p));
    const qs = params.toString();
    return `/dashboard/products${qs ? `?${qs}` : ''}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t(lang, 'products.title')}</h1>
          <p className="mt-1 text-sm text-zinc-500">{t(lang, 'products.subtitle')}</p>
        </div>
        <Link href="/dashboard/products/new" className={btn}>{t(lang, 'products.add')}</Link>
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
          <input name="q" defaultValue={search} className={`${input} w-56`} placeholder="Name or SKU" aria-label="Search products by name or SKU" maxLength={60} />
          <button className={btnGhost}>Search</button>
        </form>
      </div>

      {products.length === 0 && narrowed ? (
        <div className={`${card} py-12 text-center`}>
          <p className="text-lg font-medium">Nothing matches</p>
          <Link href="/dashboard/products" className={`${btnGhost} mt-4`}>
            Show all products
          </Link>
        </div>
      ) : products.length === 0 ? (
        <div className={`${card} py-16 text-center`}>
          <p className="text-lg font-medium">{t(lang, 'products.emptyTitle')}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500">{t(lang, 'products.emptyBody')}</p>
          <Link href="/dashboard/products/new" className={`${btn} mt-6`}>{t(lang, 'products.add')}</Link>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => {
            const cover = p.image_urls?.[0];
            const hasVariants = (p.variants?.[0]?.count ?? 0) > 0;
            return (
              <li key={p.id} className={`${card} overflow-hidden p-0`}>
                <Link href={`/dashboard/products/${p.id}`} className="block transition hover:opacity-90">
                  <div className="aspect-[4/3] bg-zinc-100">
                    {cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cover} alt={p.title_en} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-zinc-400">No photo</div>
                    )}
                  </div>
                  <div className="space-y-1 px-4 pt-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium leading-snug">{p.title_en}</p>
                      {!p.is_active && <span className="shrink-0 rounded-chip bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500">{t(lang, 'products.hidden')}</span>}
                    </div>
                    {p.title_bn && <p className="text-sm text-zinc-500">{p.title_bn}</p>}
                  </div>
                </Link>
                <div className="flex items-center justify-between gap-2 p-4 pt-2 text-sm">
                  <span className="font-semibold tabular-nums">
                    ৳{(p.discount_price_bdt ?? p.price_bdt).toLocaleString()}
                    {p.discount_price_bdt != null && <span className="ml-1.5 font-normal text-zinc-400 line-through">৳{p.price_bdt.toLocaleString()}</span>}
                  </span>
                  {/* Stock changes every day; the full editor does not need opening for it. Products with sizes keep
                      stock per size, so they are changed inside the product. */}
                  {hasVariants ? (
                    <Link href={`/dashboard/products/${p.id}`} className="text-zinc-500 underline">
                      Stock per size
                    </Link>
                  ) : canWrite ? (
                    <form action={updateStock.bind(null, p.id)} className="flex items-center gap-1.5">
                      <input
                        name="stock"
                        type="number"
                        min={0}
                        step={1}
                        defaultValue={p.stock_quantity}
                        aria-label={`Stock for ${p.title_en}`}
                        className={`${input} w-20 py-1 ${p.stock_quantity === 0 ? 'border-danger text-danger' : p.stock_quantity <= LOW_STOCK ? 'border-warning' : ''}`}
                      />
                      <button className={`${btnGhost} min-h-9 px-2.5 text-xs`}>Save</button>
                    </form>
                  ) : (
                    <span className={p.stock_quantity > 0 ? 'text-zinc-500' : 'font-medium text-danger'}>
                      {p.stock_quantity > 0 ? `${p.stock_quantity} ${t(lang, 'products.inStock')}` : t(lang, 'products.outOfStock')}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
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
            {from + PAGE_SIZE < total && (
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
