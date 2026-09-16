import { redirect } from 'next/navigation';
import { requireMerchant } from '@/lib/auth';
import { ProductForm } from '../product-form';
import { emptyProduct } from '../product-input';

export default async function NewProductPage() {
  const { tenant } = await requireMerchant();
  if (!tenant.onboarding_completed_at) redirect('/dashboard/onboarding');

  // The id is fixed up front so photos can upload into the product's folder before the first save.
  return <ProductForm tenantId={tenant.id} product={emptyProduct(crypto.randomUUID())} isNew />;
}
