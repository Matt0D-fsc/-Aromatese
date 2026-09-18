import { notFound } from 'next/navigation';
import { requireMerchant } from '@/lib/auth';
import { ProductForm } from '../product-form';
import { toProductInput, type ProductRow } from '../product-input';

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, tenant } = await requireMerchant();

  const { data } = await supabase.from('products').select('*, variants(id, name, price_bdt, stock_quantity)').eq('id', id).eq('tenant_id', tenant.id).maybeSingle();
  if (!data) notFound();

  return <ProductForm tenantId={tenant.id} product={toProductInput(data as ProductRow)} isNew={false} />;
}
