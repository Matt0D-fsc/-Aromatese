import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireMerchant } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { META_TOKEN_COOKIE } from '@/lib/channels';
import { listPages, type MetaPage } from '@/lib/meta';
import { btn, btnDanger, btnGhost, card, errorBox, hint, noticeBox } from '@/components/ui';
import { connectPage, disconnectChannels, startConnect } from './actions';

// Where a merchant connects their Facebook Page and Instagram, and sees whether it is actually live.
// Three states: nothing connected, back from Facebook with Pages to choose from, and connected.

const ERRORS: Record<string, string> = {
  cancelled: 'Facebook connection was cancelled. Nothing changed.',
  expired: 'That took too long, or the link was opened somewhere else. Please start again.',
  exchange: 'Facebook did not accept the connection. Please try again.',
  nopage: 'That Page is no longer available on your Facebook account.',
  connect: 'Could not finish connecting the Page. Please try again.',
  disconnect: 'Could not disconnect. Please try again.',
};

type Connected = { id: string; channel: string; external_id: string; name: string | null; connected_at: string };

export default async function ChannelsPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const { tenant } = await requireMerchant();
  if (!tenant.onboarding_completed_at) redirect('/dashboard/onboarding');
  const { error, connected: justConnected } = await searchParams;

  const db = createAdminClient();
  const { data } = await db.from('channel_accounts').select('id, channel, external_id, name, connected_at').eq('tenant_id', tenant.id).order('channel');
  const accounts = (data ?? []) as Connected[];

  // Set by the callback once Facebook sends them back: they are mid-flow and still have to choose a Page.
  const token = (await cookies()).get(META_TOKEN_COOKIE)?.value;
  let pages: MetaPage[] = [];
  let listFailed = false;
  if (token) {
    pages = await listPages(token).catch(() => {
      listFailed = true;
      return [];
    });
  }

  const canWrite = tenant.status !== 'suspended';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Channels</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Connect your Facebook Page so the AI answers customers in Messenger, and in Instagram DMs when your Instagram is linked to that Page.
        </p>
      </div>

      {error && (
        <p className={errorBox} role="alert">
          {ERRORS[error] ?? 'Something went wrong. Please try again.'}
        </p>
      )}
      {justConnected && <p className={noticeBox}>Connected. Send your Page a message from another account to see the AI reply.</p>}

      {token ? (
        <section className={`${card} space-y-4`}>
          <div>
            <h2 className="font-medium">Choose a Page</h2>
            <p className={hint}>The AI will answer messages sent to the Page you pick. You can change it later.</p>
          </div>

          {listFailed ? (
            <p className={errorBox} role="alert">
              Could not read your Pages from Facebook. Please start again.
            </p>
          ) : pages.length === 0 ? (
            <p className="text-sm text-zinc-500">
              This Facebook account does not manage any Page. Create a Page for your shop on Facebook first, then connect it here.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {pages.map((page) => (
                <li key={page.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{page.name}</p>
                    <p className="text-xs text-zinc-500">
                      {page.instagram_business_account
                        ? `Messenger + Instagram (@${page.instagram_business_account.username ?? 'linked account'})`
                        : 'Messenger only — no Instagram account is linked to this Page'}
                    </p>
                  </div>
                  <form action={connectPage.bind(null, page.id)}>
                    <button className={btn} disabled={!canWrite}>
                      Connect
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          <form action={startConnect}>
            <button className={btnGhost}>Start again</button>
          </form>
        </section>
      ) : accounts.length ? (
        <section className={`${card} space-y-4`}>
          <ul className="divide-y divide-line">
            {accounts.map((account) => (
              <li key={account.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{account.name ?? account.external_id}</p>
                  <p className="text-xs text-zinc-500">{account.channel === 'instagram' ? 'Instagram' : 'Facebook Messenger'}</p>
                </div>
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-strong">Live</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <form action={startConnect}>
              <button className={btnGhost} disabled={!canWrite}>
                Connect a different Page
              </button>
            </form>
            <form action={disconnectChannels}>
              <button className={btnDanger} disabled={!canWrite}>
                Disconnect
              </button>
            </form>
          </div>
          <p className={hint}>
            Disconnecting stops the AI answering on Messenger and Instagram. Your chat history stays in the inbox.
          </p>
        </section>
      ) : (
        <section className={`${card} space-y-4`}>
          <div>
            <h2 className="font-medium">Nothing connected yet</h2>
            <p className={hint}>
              You need a Facebook Page for your shop, and you must be its admin. For Instagram, link your Instagram professional account to that
              Page in Facebook settings first — then it connects here in the same step.
            </p>
          </div>
          <form action={startConnect}>
            <button className={btn} disabled={!canWrite}>
              Connect Facebook Page
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
