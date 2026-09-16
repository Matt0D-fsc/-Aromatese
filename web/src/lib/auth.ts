import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';

export type TenantStatus = 'invited' | 'active' | 'suspended';

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  contact_email: string | null;
  contact_phone: string | null;
  business_category: string | null;
  address: string | null;
  monthly_message_limit: number;
  onboarding_completed_at: string | null;
};

// cache(): layout + page share one lookup per request.
export const getSession = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: membership }] = await Promise.all([
    supabase.from('profiles').select('is_platform_admin').eq('id', user.id).maybeSingle(),
    supabase.from('tenant_members').select('tenants(*)').eq('user_id', user.id).limit(1).maybeSingle(),
  ]);

  return {
    supabase,
    user,
    isAdmin: Boolean(profile?.is_platform_admin),
    tenant: (membership?.tenants ?? null) as unknown as Tenant | null,
  };
});

export async function requireAdmin() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!session.isAdmin) redirect('/');
  return session;
}

export async function requireMerchant() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!session.tenant) redirect(session.isAdmin ? '/admin' : '/login?error=no-shop');
  return { ...session, tenant: session.tenant };
}
