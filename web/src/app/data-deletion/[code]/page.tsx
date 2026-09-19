import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { card } from '@/components/ui';
import { DELETION_EVENT } from '@/app/api/meta/data-deletion/route';

// Where a confirmation code leads. Meta requires the deletion callback to hand back a URL showing the status
// of the request, and this is it — public, because the person asking has no account here to sign in to.

export const metadata = { title: 'Data deletion · ChatNab' };

export default async function DataDeletionStatus({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  const { data } = await createAdminClient()
    .from('audit_logs')
    .select('created_at, detail')
    .eq('event_type', DELETION_EVENT)
    .filter('detail->>code', 'eq', code.slice(0, 32))
    .filter('detail->>completed', 'eq', 'true')
    .maybeSingle();

  const detail = data?.detail as { customers?: number; media?: number } | undefined;

  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <div className={`${card} space-y-4`}>
        <h1 className="text-2xl font-semibold">Data deletion</h1>
        <p className="text-sm text-zinc-500">
          Confirmation code <span className="font-mono text-foreground">{code}</span>
        </p>

        {!data ? (
          <p className="text-sm">
            We have no record of this confirmation code. Check it for typos, or ask again from your Facebook or Instagram settings, under Apps and
            Websites.
          </p>
        ) : detail?.customers ? (
          <>
            <p className="text-sm">
              Done. Your messages, voice notes and photos were deleted from every shop you had messaged through ChatNab, and your name and phone
              number were removed.
            </p>
            <p className="text-sm text-zinc-500">
              Shops keep a record of orders you actually placed, as their own tax and accounting rules require. Those records no longer carry your
              name, phone number or address.
            </p>
          </>
        ) : (
          <p className="text-sm">
            Done. We found no messages belonging to you — nothing of yours was stored here, so there was nothing to delete.
          </p>
        )}

        <p className="pt-2 text-xs text-zinc-500">
          Requested {data ? new Date(data.created_at).toLocaleDateString('en-GB', { dateStyle: 'medium' }) : 'recently'} ·{' '}
          <Link href="/privacy" className="underline">
            Privacy policy
          </Link>
        </p>
      </div>
    </main>
  );
}
