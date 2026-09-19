import { randomBytes } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { audit, auditError } from '@/lib/audit';
import { CHAT_MEDIA_BUCKET } from '@/lib/chat';
import { verifySignedRequest } from '@/lib/meta';
import { siteUrl } from '@/lib/site';

// Meta's mandatory data deletion callback. Someone removes ChatNab from their Facebook or Instagram account
// and asks for their data back; Meta posts a signed request here naming them, and expects a status URL and a
// confirmation code in return.
//
// Public endpoint, and the only thing standing between it and every customer's chat history is the signature —
// so nothing is read or deleted until the request verifies.

export const DELETION_EVENT = 'customer.deleted_by_request';

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const verified = verifySignedRequest(String(form?.get('signed_request') ?? ''));
  if (!verified) return Response.json({ error: 'Invalid signed request' }, { status: 400 });

  // Readable over the phone, which is how a customer chasing this will end up quoting it.
  const code = randomBytes(6).toString('hex');
  const url = `${await siteUrl()}/data-deletion/${code}`;

  try {
    await erase(verified.userId, code);
  } catch (err) {
    await auditError('meta.data_deletion', err, { detail: { code } });
    // Still a valid receipt: the status page tells them where it stands, and Meta gets its answer.
  }

  return Response.json({ url, confirmation_code: code });
}

// One person can be a customer of several shops — the same Facebook account messaging two Pages — and each
// shop holds its own chats with them. All of it goes.
async function erase(channelUserId: string, code: string) {
  const db = createAdminClient();
  const { data: customers, error } = await db
    .from('customers')
    .select('id, tenant_id')
    .eq('channel_user_id', channelUserId)
    .in('channel', ['messenger', 'instagram']);
  if (error) throw error;

  let media = 0;
  for (const customer of customers ?? []) {
    // The same function the merchant's own "forget this customer" button uses: chats and media gone, the
    // identity scrambled, order records kept but stripped of the address.
    const { data: paths, error: rpcError } = await db.rpc('delete_customer_data', { cid: customer.id });
    if (rpcError) throw rpcError;

    const files = ((paths ?? []) as string[]).filter(Boolean);
    if (files.length) {
      // SQL cannot empty a bucket, so the voice notes and photos are removed by path.
      const { data: deleted, error: removeError } = await db.storage.from(CHAT_MEDIA_BUCKET).remove(files);
      media += deleted?.length ?? 0;
      if (removeError) await auditError('meta.data_deletion_media', removeError, { tenantId: customer.tenant_id, detail: { code } });
    }
    await audit(DELETION_EVENT, { tenantId: customer.tenant_id, detail: { code, customerId: customer.id } });
  }

  // Recorded even when nobody matched, so the status page can tell them the request was received and there
  // was nothing of theirs to delete — which is the honest answer, not an error.
  await audit(DELETION_EVENT, { detail: { code, customers: customers?.length ?? 0, media, completed: true } });
}
