import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireMerchant } from '@/lib/auth';
import { getLang, t } from '@/lib/i18n';
import { btn, card } from '@/components/ui';
import type { ProductRow } from './products/product-input';

export default async function ProductsPage() {
  const [{ supabase, tenant }, lang] = await Promise.all([requireMerchant(), getLang()]);
  if (!tenant.onboarding_completed_at) redirect('/dashboard/onboarding');

  const { data } = await supabase
    .from('products')
    .select('id, sku, title_en, title_bn, price_bdt, discount_price_bdt, stock_quantity, is_active, image_urls')
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false });
  const products = (data ?? []) as ProductRow[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t(lang, 'products.title')}</h1>
          <p className="mt-1 text-sm text-zinc-500">{t(lang, 'products.subtitle')}</p>
        </div>
        <Link href="/dashboard/products/new" className={btn}>{t(lang, 'products.add')}</Link>
      </div>

      {products.length === 0 ? (
        <div className={`${card} py-16 text-center`}>
          <p className="text-lg font-medium">{t(lang, 'products.emptyTitle')}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500">
            {t(lang, 'products.emptyBody')}
          </p>
          <Link href="/dashboard/products/new" className={`${btn} mt-6`}>{t(lang, 'products.add')}</Link>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => {
            const cover = p.image_urls?.[0];
            return (
              <li key={p.id}>
                <Link href={`/dashboard/products/${p.id}`} className={`${card} block overflow-hidden p-0 transition hover:border-zinc-400`}>
                  <div className="aspect-[4/3] bg-zinc-100">
                    {cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cover} alt={p.title_en} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-zinc-400">No photo</div>
                    )}
                  </div>
                  <div className="space-y-1 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium leading-snug">{p.title_en}</p>
                      {!p.is_active && <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500">{t(lang, 'products.hidden')}</span>}
                    </div>
                    {p.title_bn && <p className="text-sm text-zinc-500">{p.title_bn}</p>}
                    <div className="flex items-center justify-between pt-1 text-sm">
                      <span className="font-semibold tabular-nums">
                        ৳{(p.discount_price_bdt ?? p.price_bdt).toLocaleString()}
                        {p.discount_price_bdt != null && (
                          <span className="ml-1.5 font-normal text-zinc-400 line-through">৳{p.price_bdt.toLocaleString()}</span>
                        )}
                      </span>
                      <span className={p.stock_quantity > 0 ? 'text-zinc-500' : 'font-medium text-red-600'}>
                        {p.stock_quantity > 0 ? `${p.stock_quantity} ${t(lang, 'products.inStock')}` : t(lang, 'products.outOfStock')}
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
