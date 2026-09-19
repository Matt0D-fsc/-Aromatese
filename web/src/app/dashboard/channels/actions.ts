'use server';

import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireMerchant } from '@/lib/auth';
import { audit, auditError } from '@/lib/audit';
import { META_STATE_COOKIE, META_TOKEN_COOKIE, META_TOKEN_TTL } from '@/lib/channels';
import { listPages, oauthUrl, setPageSubscription } from '@/lib/meta';
import { createAdminClient } from '@/lib/supabase/admin';
import { siteUrl } from '@/lib/site';

// Connecting a shop's Facebook Page and Instagram account. channel_accounts is service-role only (migration
// 019) because its rows hold Page tokens, so every read and write here goes through the admin client, scoped
// to the tenant the signed-in merchant belongs to.

async function merchantSession() {
  const session = await requireMerchant();
  if (session.tenant.status === 'suspended') throw new Error('Your shop is suspended.');
  return session;
}

const redirectUri = async () => `${await siteUrl()}/api/meta/callback`;

/** Sends the merchant to Facebook to grant access. */
export async function startConnect() {
  await merchantSession();

  // Comes back from Meta untouched, and is compared against this cookie: proof the trip started here, in
  // this browser, rather than in a link someone sent them.
  const state = randomUUID();
  (await cookies()).set(META_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: META_TOKEN_TTL,
  });
  redirect(oauthUrl(await redirectUri(), state));
}

/**
 * Connects one Page: subscribes it to our webhook, saves its token, and brings the linked Instagram account
 * along. Instagram messaging runs on the Page's token, so one grant covers both channels.
 */
export async function connectPage(pageId: string) {
  const { tenant, user } = await merchantSession();
  const token = (await cookies()).get(META_TOKEN_COOKIE)?.value;
  if (!token) redirect('/dashboard/channels?error=expired');

  try {
    const page = (await listPages(token)).find((p) => p.id === pageId);
    if (!page) redirect('/dashboard/channels?error=nopage');

    // Subscribe first: a saved row whose Page never got subscribed is a shop that looks connected and
    // receives nothing.
    await setPageSubscription(page, true);

    const db = createAdminClient();
    const rows = [{ tenant_id: tenant.id, channel: 'messenger', external_id: page.id, page_token: page.access_token, name: page.name }];
    if (page.instagram_business_account) {
      rows.push({
        tenant_id: tenant.id,
        channel: 'instagram',
        external_id: page.instagram_business_account.id,
        page_token: page.access_token,
        name: page.instagram_business_account.username ?? page.name,
      });
    }
    // onConflict on the unique (channel, external_id): reconnecting the same Page refreshes its token
    // instead of failing, which is what a merchant expects after changing their Facebook password.
    const { error } = await db.from('channel_accounts').upsert(rows, { onConflict: 'channel,external_id' });
    if (error) throw error;

    await audit('channel.connected', {
      actorId: user.id,
      tenantId: tenant.id,
      detail: { page: page.name, pageId: page.id, instagram: Boolean(page.instagram_business_account) },
    });
  } catch (err) {
    // redirect() works by throwing; let it through rather than reporting it as a failure.
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err;
    await auditError('meta.connect_page', err, { actorId: user.id, tenantId: tenant.id, detail: { pageId } });
    redirect('/dashboard/channels?error=connect');
  }

  (await cookies()).delete(META_TOKEN_COOKIE);
  revalidatePath('/dashboard/channels');
  redirect('/dashboard/channels?connected=1');
}

/**
 * Disconnects everything this shop has connected. Meta keeps sending to a subscribed Page even after we
 * forget its token, so the subscription is cancelled before the rows go.
 * ponytail: all-or-nothing, because a shop connects one Page; make it per-row when one shop runs two.
 */
export async function disconnectChannels() {
  const { tenant, user } = await merchantSession();
  const db = createAdminClient();

  const { data: accounts } = await db.from('channel_accounts').select('id, channel, external_id, page_token, name').eq('tenant_id', tenant.id);
  for (const account of accounts ?? []) {
    if (account.channel !== 'messenger') continue; // Instagram has no subscription of its own; the Page carries it.
    // A revoked or expired token cannot be unsubscribed, and that must not stop us forgetting it.
    await setPageSubscription({ id: account.external_id, access_token: account.page_token }, false).catch((err) =>
      auditError('meta.unsubscribe', err, { actorId: user.id, tenantId: tenant.id, detail: { pageId: account.external_id } }),
    );
  }

  const { error } = await db.from('channel_accounts').delete().eq('tenant_id', tenant.id);
  if (error) {
    await auditError('meta.disconnect', error, { actorId: user.id, tenantId: tenant.id });
    redirect('/dashboard/channels?error=disconnect');
  }

  await audit('channel.disconnected', { actorId: user.id, tenantId: tenant.id, detail: { count: accounts?.length ?? 0 } });
  revalidatePath('/dashboard/channels');
}
