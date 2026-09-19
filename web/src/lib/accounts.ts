import { createAdminClient } from '@/lib/supabase/admin';
import { siteUrl } from '@/lib/site';

// Getting a person a login, for a new merchant (admin panel) and for a shop's staff (Team page). Email delivery
// is the one part of this that cannot be counted on in Bangladesh, so it is one option of three:
//   'create' + password  -> the account works now; whoever made it hands the password over.
//   'create', no password -> the account exists and a one-time link lets them choose their own password.
//   'email'              -> Supabase emails the invite (needs SMTP).

export type LoginMethod = 'create' | 'email';

export const readLoginForm = (formData: FormData) => ({
  method: (formData.get('method') === 'email' ? 'email' : 'create') as LoginMethod,
  password: String(formData.get('password') ?? ''),
});

export async function createLogin(email: string, method: LoginMethod, password: string): Promise<{ userId: string } | { error: string }> {
  if (method === 'create' && password && password.length < 8) return { error: 'The starting password needs at least 8 characters.' };
  const admin = createAdminClient();
  const { data, error } =
    method === 'email'
      ? await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${await siteUrl()}/auth/set-password` })
      : // email_confirm: the address is a login name here, not proof of an inbox; nobody is sent anything.
        await admin.auth.admin.createUser({ email, email_confirm: true, ...(password && { password }) });
  if (error || !data.user) return { error: error?.message ?? 'Could not create the account.' };
  return { userId: data.user.id };
}

// A one-time link to /auth/set-password. "recovery" works whether or not they have ever had a password, and
// generateLink returns the URL without sending anything.
export async function oneTimeLink(email: string): Promise<{ link: string } | { error: string }> {
  const { data, error } = await createAdminClient().auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: `${await siteUrl()}/auth/set-password` },
  });
  if (error || !data.properties?.action_link) return { error: error?.message ?? 'Could not create a link.' };
  return { link: data.properties.action_link };
}

// What to tell the person creating the account, once it exists.
export async function handover(email: string, method: LoginMethod, password: string): Promise<{ message: string; link?: string }> {
  if (method === 'email') return { message: `Invite sent to ${email}.` };
  if (password) return { message: `Ready. They sign in at /login as ${email} with the password you set, and can change it afterwards.` };
  const res = await oneTimeLink(email);
  if ('error' in res) return { message: `The account is created, but no link could be made (${res.error}). Ask the ChatNab team for a sign-in link.` };
  return { message: `Send ${email} this one-time link to choose their password. Open it in a private window if you test it yourself.`, link: res.link };
}
