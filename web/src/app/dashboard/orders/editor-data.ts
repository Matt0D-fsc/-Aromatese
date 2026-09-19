import type { SupabaseClient } from '@supabase/supabase-js';
import type { EditorProduct } from './order-editor';
import { deliveryFees } from '@/lib/orders';
import { readPolicies, type ShopPolicies } from '@/lib/policies';

// ponytail: every active product goes to the picker, capped at 500; a search box when catalogs outgrow a <select>.
export async function editorData(supabase: SupabaseClient, tenant: { id: string; policies: ShopPolicies | null }) {
  const { data } = await supabase
    .from('products')
    .select('id, title_en, price_bdt, discount_price_bdt, stock_quantity, variants(name, price_bdt, stock_quantity)')
    .eq('tenant_id', tenant.id)
    .eq('is_active', true)
    .order('title_en')
    .limit(500);

  const products: EditorProduct[] = (data ?? []).map((p) => {
    const price = Number(p.discount_price_bdt ?? p.price_bdt);
    return {
      id: p.id,
      title: p.title_en,
      price,
      stock: p.stock_quantity,
      // A size without its own price sells at the product's price, as search_products reports it to the AI.
      variants: ((p.variants ?? []) as { name: string; price_bdt: number | null; stock_quantity: number }[]).map((v) => ({
        name: v.name,
        price: v.price_bdt == null ? Number(p.price_bdt) : Number(v.price_bdt),
        stock: v.stock_quantity,
      })),
    };
  });
  return { products, fees: deliveryFees(readPolicies(tenant.policies)) };
}
