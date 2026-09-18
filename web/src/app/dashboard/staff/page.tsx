import { redirect } from 'next/navigation';
import { requireMerchant } from '@/lib/auth';
import { btnDanger, card } from '@/components/ui';
import { dhakaTime } from '@/lib/chat';
import { InviteStaffForm } from './invite-form';
import { removeStaff } from './actions';

type MemberRow = { user_id: string; role: string; created_at: string };

export default async function StaffPage() {
  const { supabase, tenant, user } = await requireMerchant();
  if (!tenant.onboarding_completed_at) redirect('/dashboard/onboarding');

  const { data } = await supabase.from('tenant_members').select('user_id, role, created_at').eq('tenant_id', tenant.id).order('created_at');
  const members = (data ?? []) as MemberRow[];

  // tenant_members points at auth.users, which PostgREST cannot join to profiles; one extra query matches them up.
  const { data: profileRows } = members.length ? await supabase.from('profiles').select('id, email, full_name').in('id', members.map((m) => m.user_id)) : { data: [] };
  const profiles = new Map(((profileRows ?? []) as { id: string; email: string | null; full_name: string | null }[]).map((p) => [p.id, p]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Your team</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Everyone here can reply to customers, take over chats and confirm orders. Each person signs in as themselves, so you can see who did what.
        </p>
      </div>

      <section className={card}>
        <h2 className="mb-4 text-base font-semibold">Add someone</h2>
        <InviteStaffForm />
      </section>

      <section className={`${card} p-0`}>
        <ul className="divide-y divide-zinc-100">
          {members.map((m) => {
            const profile = profiles.get(m.user_id);
            const isMe = m.user_id === user.id;
            return (
              <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 text-sm">
                <div>
                  <p className="font-medium">
                    {profile?.full_name || profile?.email || 'Invited, not signed in yet'}
                    {isMe && <span className="ml-2 text-xs font-normal text-zinc-500">you</span>}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {m.role} · joined {dhakaTime(m.created_at)}
                  </p>
                </div>
                {m.role === 'staff' && !isMe && tenant.status !== 'suspended' && (
                  <form action={removeStaff.bind(null, m.user_id)}>
                    <button className={btnDanger}>Remove</button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
