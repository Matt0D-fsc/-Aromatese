'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireMerchant } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';

export type ShopFormState = { error?: string };

export async function saveShopProfile(_prev: ShopFormState, formData: FormData): Promise<ShopFormState> {
  const { tenant } = await requireMerchant();
  if (tenant.status === 'suspended') return { error: 'Your shop is suspended. Contact the ChatNab team.' };

  const field = (key: string) => String(formData.get(key) ?? '').trim();
  const name = field('name');
  const contactPhone = field('contactPhone');
  const businessCategory = field('businessCategory');
  const address = field('address');

  if (!name || name.length > 255) return { error: 'Shop name is required (max 255 characters).' };
  if (!/^\+?[\d\s-]{7,20}$/.test(contactPhone)) return { error: 'Enter a valid phone number, e.g. 01712345678.' };
  if (!businessCategory) return { error: 'Pick what your shop sells.' };

  // Merchants can't write the tenants table directly (status and limits are admin-only),
  // so this whitelisted update runs with the service role for the caller's own tenant only.
  const { error } = await createAdminClient()
    .from('tenants')
    .update({
      name,
      contact_phone: contactPhone,
      business_category: businessCategory,
      address: address || null,
      onboarding_completed_at: tenant.onboarding_completed_at ?? new Date().toISOString(),
      status: tenant.status === 'invited' ? 'active' : tenant.status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', tenant.id);
  if (error) return { error: error.message };

  revalidatePath('/dashboard', 'layout');
  redirect('/dashboard');
}
