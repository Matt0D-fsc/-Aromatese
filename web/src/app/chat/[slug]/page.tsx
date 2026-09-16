import type { Metadata } from 'next';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { MESSAGE_COLUMNS, VISITOR_COOKIE, toChatLine, type ChatLine, type MessageRow } from '@/lib/chat';
import { ChatClient } from './chat-client';

type Props = { params: Promise<{ slug: string }> };

// Public page: the service role reads only this shop's name and this visitor's own thread (keyed by an httpOnly cookie).
const getShop = cache(async (slug: string) => {
  const { data } = await createAdminClient().from('tenants').select('id, name, status').eq('slug', slug).maybeSingle();
  return data?.status === 'active' ? data : null;
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const shop = await getShop((await params).slug);
  return { title: shop ? `Chat with ${shop.name}` : 'Shop not found' };
}

export default async function ChatPage({ params }: Props) {
  const { slug } = await params;
  const shop = await getShop(slug);
  if (!shop) notFound();

  let initial: ChatLine[] = [];
  const visitor = (await cookies()).get(VISITOR_COOKIE)?.value;
  if (visitor) {
    const db = createAdminClient();
    const { data: customer } = await db
      .from('customers')
      .select('id')
      .eq('tenant_id', shop.id)
      .eq('channel', 'web')
      .eq('channel_user_id', visitor)
      .maybeSingle();
    const { data: conversation } = customer
      ? await db.from('conversations').select('id').eq('customer_id', customer.id).eq('channel', 'web').maybeSingle()
      : { data: null };
    if (conversation) {
      const { data } = await db
        .from('messages')
        .select(MESSAGE_COLUMNS)
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: false })
        .limit(50);
      initial = ((data ?? []) as MessageRow[]).reverse().map(toChatLine);
    }
  }

  return <ChatClient slug={slug} shopName={shop.name} initial={initial} since={initial.at(-1)?.createdAt ?? null} />;
}
