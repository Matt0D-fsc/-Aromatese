'use server';

import { revalidatePath } from 'next/cache';
import { requireMerchant } from '@/lib/auth';
import { audit, throwAudited } from '@/lib/audit';
import { CHAT_MEDIA_BUCKET } from '@/lib/chat';
import { createAdminClient } from '@/lib/supabase/admin';

async function staffSession() {
  const session = await requireMerchant();
  if (session.tenant.status === 'suspended') throw new Error('Your shop is suspended.');
  return session;
}

// RLS limits writes to the merchant's own shop; the tenant_id filter keeps that explicit.
async function updateConversation(conversationId: string, values: Record<string, unknown>, event: string) {
  const { supabase, tenant, user } = await staffSession();
  const { error } = await supabase.from('conversations').update(values).eq('id', conversationId).eq('tenant_id', tenant.id);
  if (error) await throwAudited(event, error, { actorId: user.id, tenantId: tenant.id, detail: { conversationId } });
  await audit(event, { actorId: user.id, tenantId: tenant.id, detail: { conversationId } });
  revalidatePath('/dashboard', 'layout');
}

export async function takeOver(conversationId: string) {
  await updateConversation(conversationId, { ai_muted: true, needs_human: false, taken_over_at: new Date().toISOString() }, 'chat.taken_over');
}

export async function handBack(conversationId: string) {
  await updateConversation(conversationId, { ai_muted: false, needs_human: false }, 'chat.handed_back');
}

export async function dismissAlert(conversationId: string) {
  await updateConversation(conversationId, { needs_human: false }, 'chat.alert_dismissed');
}

export async function sendStaffReply(conversationId: string, formData: FormData) {
  const text = String(formData.get('text') ?? '').trim().slice(0, 2000);
  if (!text) return;

  const { supabase, tenant, user } = await staffSession();
  // The (conversation_id, tenant_id) foreign key rejects another shop's conversation.
  const { error } = await supabase.from('messages').insert({
    tenant_id: tenant.id,
    conversation_id: conversationId,
    sender_type: 'agent',
    content_type: 'text',
    content_text: text,
    sent_by: user.id,
  });
  if (error) await throwAudited('chat.staff_reply', error, { actorId: user.id, tenantId: tenant.id, detail: { conversationId } });

  // Replying is taking over: the AI stays quiet until staff hands back or goes idle for 30 minutes.
  const now = new Date().toISOString();
  await updateConversation(conversationId, { ai_muted: true, needs_human: false, last_staff_reply_at: now, last_message_at: now }, 'chat.staff_reply');
}

// A customer's right to be forgotten, and the merchant's way to honour it. delete_customer_data clears the
// chats and the identity and hands back the storage paths it orphaned, because SQL cannot empty a bucket.
export async function forgetCustomer(customerId: string): Promise<void> {
  const { supabase, tenant, user } = await staffSession();

  const { data: paths, error } = await supabase.rpc('delete_customer_data', { cid: customerId });
  if (error) await throwAudited('customer.forget', error, { actorId: user.id, tenantId: tenant.id, detail: { customerId } });

  const files = ((paths ?? []) as string[]).filter(Boolean);
  let removed = 0;
  if (files.length) {
    // chat-media carries a SELECT policy only (migration 009), so the merchant's own client cannot delete from
    // it — RLS would reject this silently and leave the voice notes and photos behind while the UI claimed the
    // customer was forgotten. Deletion runs with the service role, scoped to the paths the function returned.
    const { data: deleted, error: removeError } = await createAdminClient().storage.from(CHAT_MEDIA_BUCKET).remove(files);
    removed = deleted?.length ?? 0;
    if (removeError || removed !== files.length) {
      await audit('error.customer.forget_media', {
        actorId: user.id,
        tenantId: tenant.id,
        detail: { customerId, expected: files.length, removed, message: removeError?.message ?? 'some files were not removed' },
      });
    }
  }

  await audit('customer.forgotten', { actorId: user.id, tenantId: tenant.id, detail: { customerId, mediaExpected: files.length, mediaDeleted: removed } });
  revalidatePath('/dashboard', 'layout');
}
