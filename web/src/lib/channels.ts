import { createAdminClient } from '@/lib/supabase/admin';
import { sendMessage } from '@/lib/meta';

// Getting a message out to a customer who is not on the web chat. On the web, saving the row is the delivery —
// the widget polls for it. On Messenger and Instagram nothing is polling, so the message has to be pushed to
// Meta, and it can be refused: a Page token can be revoked, and Meta closes the window a shop may reply in.
//
// Reads channel_accounts, which is service-role only (migration 019), so this always uses the admin client.
// The caller has already established that the conversation belongs to the shop it names.

// The connect flow's two cookies. Both are httpOnly and short-lived: one proves the merchant started the trip
// to Meta, the other carries the token between Meta sending them back and them picking a Page. Neither ever
// reaches the browser's scripts, and the token never goes in a URL.
export const META_STATE_COOKIE = 'cn_meta_state';
export const META_TOKEN_COOKIE = 'cn_meta_token';
export const META_TOKEN_TTL = 15 * 60;

/** Raised when the customer could not be reached, so the caller can tell staff before recording a reply. */
export class DeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeliveryError';
  }
}

/**
 * Sends text to whoever owns this conversation. Does nothing for web chat, where the saved row is the delivery.
 * Throws DeliveryError when a Meta conversation exists but the message could not be handed over.
 */
export async function deliverToConversation(tenantId: string, conversationId: string, text: string): Promise<void> {
  const db = createAdminClient();

  const { data: conversation } = await db.from('conversations').select('channel, customer_id').eq('id', conversationId).eq('tenant_id', tenantId).maybeSingle();
  if (!conversation || conversation.channel === 'web') return;

  const [{ data: customer }, { data: account }] = await Promise.all([
    db.from('customers').select('channel_user_id').eq('id', conversation.customer_id).maybeSingle(),
    db.from('channel_accounts').select('external_id, page_token').eq('tenant_id', tenantId).eq('channel', conversation.channel).maybeSingle(),
  ]);
  if (!customer) throw new DeliveryError('This customer no longer exists.');
  // The Page was disconnected after the conversation started. Nothing can reach this customer until it is
  // reconnected, and staff need to hear that rather than watch their reply sit unread forever.
  if (!account) {
    const channel = conversation.channel === 'instagram' ? 'Instagram' : 'Facebook Page';
    throw new DeliveryError(`This chat came from ${channel}, which is not connected any more. Reconnect it to reply here.`);
  }

  try {
    await sendMessage({ externalId: account.external_id, pageToken: account.page_token }, customer.channel_user_id, text);
  } catch (err) {
    // Meta only lets a shop reply within 24 hours of the customer's last message. Past that the customer has
    // to write again, and no amount of retrying helps — so say what happened instead of "send failed".
    const status = (err as { status?: number })?.status;
    throw new DeliveryError(
      status === 400
        ? 'Meta would not deliver this. A shop can only reply within 24 hours of the customer’s last message — they will have to message you again.'
        : 'Could not reach the customer on Messenger or Instagram just now. Please try again.',
    );
  }
}
