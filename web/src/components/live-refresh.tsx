'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

const TABLES = ['messages', 'conversations', 'orders', 'products'];

// Re-renders the current page when chats, orders or products change, so dashboards update without a reload.
// RLS decides which rows this user hears about: a merchant only their shop, the admin every shop.
export function LiveRefresh({ tenantId }: { tenantId?: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // One AI reply writes several rows; refresh once after they settle.
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 400);
    };

    const filter = tenantId ? `tenant_id=eq.${tenantId}` : undefined;
    const channel = supabase.channel(`live-${tenantId ?? 'admin'}`);
    for (const table of TABLES) channel.on('postgres_changes', { event: '*', schema: 'public', table, filter }, refresh);
    channel.subscribe();

    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [router, tenantId]);

  return null;
}
