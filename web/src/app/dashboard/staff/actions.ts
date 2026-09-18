'use server';

import { revalidatePath } from 'next/cache';
import { requireMerchant } from '@/lib/auth';
import { audit, throwAudited } from '@/lib/audit';
import { createAdminClient } from '@/lib/supabase/admin';
import { siteUrl } from '@/lib/site';

export type StaffState = { error?: string; message?: string };

// Staff get their own login rather than sharing the owner's, so the audit trail names a person and losing a
// phone does not mean changing one password everybody knows.
export async function inviteStaff(_prev: StaffState, formData: FormData): Promise<StaffState> {
  const { tenant, user } = await requireMerchant();
  if (tenant.status === 'suspended') return { error: 'Your shop is suspended. Contact the ChatNab team.' };

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email.' };

  const admin = createAdminClient();
  const { data: invite, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${await siteUrl()}/auth/set-password`,
  });
  if (inviteError || !invite.user) {
    // Someone with this email already has a login, e.g. they work for another shop too.
    return { error: inviteError?.message ?? 'Could not send the invite.' };
  }

  const { error } = await admin.from('tenant_members').insert({ tenant_id: tenant.id, user_id: invite.user.id, role: 'staff' });
  if (error) {
    await admin.auth.admin.deleteUser(invite.user.id);
    return { error: error.code === '23505' ? 'They are already on your team.' : error.message };
  }

  await audit('staff.invited', { actorId: user.id, tenantId: tenant.id, detail: { email } });
  revalidatePath('/dashboard/staff');
  return { message: `Invite sent to ${email}.` };
}

// Only staff can be removed, and never yourself: an owner must not be able to lock their own shop away, and a
// shop must never end up with nobody who can sign in.
export async function removeStaff(userId: string): Promise<void> {
  const { supabase, tenant, user } = await requireMerchant();
  if (tenant.status === 'suspended') throw new Error('Your shop is suspended.');
  if (userId === user.id) throw new Error('You cannot remove yourself.');

  const { error } = await supabase.from('tenant_members').delete().eq('tenant_id', tenant.id).eq('user_id', userId).eq('role', 'staff');
  if (error) await throwAudited('staff.remove', error, { actorId: user.id, tenantId: tenant.id, detail: { userId } });

  await audit('staff.removed', { actorId: user.id, tenantId: tenant.id, detail: { userId } });
  revalidatePath('/dashboard/staff');
}
