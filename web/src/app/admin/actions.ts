'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { siteUrl } from '@/lib/site';

export type InviteState = { error?: string; message?: string };

export async function inviteMerchant(_prev: InviteState, formData: FormData): Promise<InviteState> {
  await requireAdmin();

  const shopName = String(formData.get('shopName') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const limit = Number(formData.get('limit') ?? 1000);
  if (!shopName || shopName.length > 255) return { error: 'Shop name is required (max 255 characters).' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email.' };
  if (!Number.isInteger(limit) || limit < 0) return { error: 'Message limit must be a whole number.' };

  const admin = createAdminClient();
  const base = shopName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'shop';
  const slug = `${base}-${crypto.randomUUID().slice(0, 6)}`;

  const { data: tenant, error: tenantError } = await admin
    .from('tenants')
    .insert({ name: shopName, slug, contact_email: email, monthly_message_limit: limit, status: 'invited' })
    .select('id')
    .single();
  if (tenantError) return { error: tenantError.message };

  const { data: invite, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${await siteUrl()}/auth/set-password`,
  });
  if (inviteError || !invite.user) {
    await admin.from('tenants').delete().eq('id', tenant.id);
    return { error: inviteError?.message ?? 'Invite failed.' };
  }

  const { error: memberError } = await admin
    .from('tenant_members')
    .insert({ tenant_id: tenant.id, user_id: invite.user.id, role: 'owner' });
  if (memberError) {
    await admin.auth.admin.deleteUser(invite.user.id);
    await admin.from('tenants').delete().eq('id', tenant.id);
    return { error: memberError.message };
  }

  revalidatePath('/admin');
  return { message: `Invite sent to ${email}.` };
}

export async function setTenantStatus(tenantId: string, status: 'active' | 'suspended') {
  await requireAdmin();
  if (status !== 'active' && status !== 'suspended') throw new Error('Invalid status');
  const { error } = await createAdminClient().from('tenants').update({ status }).eq('id', tenantId);
  if (error) throw new Error(error.message);
  revalidatePath('/admin');
}

export async function updateMessageLimit(tenantId: string, formData: FormData) {
  await requireAdmin();
  const limit = Number(formData.get('limit'));
  if (!Number.isInteger(limit) || limit < 0) throw new Error('Message limit must be a whole number.');
  const { error } = await createAdminClient().from('tenants').update({ monthly_message_limit: limit }).eq('id', tenantId);
  if (error) throw new Error(error.message);
  revalidatePath('/admin');
}
