'use server';

import { revalidatePath } from 'next/cache';
import { requireMerchant } from '@/lib/auth';
import { audit, throwAudited } from '@/lib/audit';
import { createAdminClient } from '@/lib/supabase/admin';
import { createLogin, handover, readLoginForm } from '@/lib/accounts';

export type StaffState = { error?: string; message?: string; link?: string };

// The only roles that exist. tenant_members.role carries CHECK (role IN ('owner', 'staff')) from migration
// 003, so anything else — 'admin', say — cannot be stored and would be an unreachable branch here. Widening
// this list means adding the role to that constraint in a migration first.
const TEAM_MANAGER_ROLES = ['owner'] as const;

// requireMerchant only proves membership. Team management hands out access to the whole shop through the
// service role, so it has to prove ownership as well — otherwise any staff member could add accounts.
async function requireOwner() {
  const session = await requireMerchant();
  const { data } = await session.supabase
    .from('tenant_members')
    .select('role')
    .eq('tenant_id', session.tenant.id)
    .eq('user_id', session.user.id)
    .maybeSingle();
  return { ...session, isOwner: TEAM_MANAGER_ROLES.includes(data?.role as (typeof TEAM_MANAGER_ROLES)[number]) };
}

// Staff get their own login rather than sharing the owner's, so the audit trail names a person and losing a
// phone does not mean changing one password everybody knows.
export async function inviteStaff(_prev: StaffState, formData: FormData): Promise<StaffState> {
  const { tenant, user, isOwner } = await requireOwner();
  if (!isOwner) return { error: 'Only the shop owner can add people to the team.' };
  if (tenant.status === 'suspended') return { error: 'Your shop is suspended. Contact the ChatNab team.' };

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email.' };

  // The same three ways in as a new merchant: a password to hand over, a one-time link, or an emailed invite.
  const { method, password } = readLoginForm(formData);
  const login = await createLogin(email, method, password);
  // Most often: someone with this email already has a login, e.g. they work for another shop too.
  if ('error' in login) return { error: login.error };

  const admin = createAdminClient();
  const { error } = await admin.from('tenant_members').insert({ tenant_id: tenant.id, user_id: login.userId, role: 'staff' });
  if (error) {
    await admin.auth.admin.deleteUser(login.userId);
    return { error: error.code === '23505' ? 'They are already on your team.' : error.message };
  }

  await audit('staff.invited', { actorId: user.id, tenantId: tenant.id, detail: { email, method } });
  revalidatePath('/dashboard/staff');
  return handover(email, method, password);
}

// Only staff can be removed, and never yourself: an owner must not be able to lock their own shop away, and a
// shop must never end up with nobody who can sign in.
export async function removeStaff(userId: string): Promise<void> {
  const { supabase, tenant, user, isOwner } = await requireOwner();
  if (!isOwner) throw new Error('Only the shop owner can remove people from the team.');
  if (tenant.status === 'suspended') throw new Error('Your shop is suspended.');
  if (userId === user.id) throw new Error('You cannot remove yourself.');

  const { error } = await supabase.from('tenant_members').delete().eq('tenant_id', tenant.id).eq('user_id', userId).eq('role', 'staff');
  if (error) await throwAudited('staff.remove', error, { actorId: user.id, tenantId: tenant.id, detail: { userId } });

  await audit('staff.removed', { actorId: user.id, tenantId: tenant.id, detail: { userId } });
  revalidatePath('/dashboard/staff');
}
