'use server';

import { revalidatePath } from 'next/cache';
import { requireMerchant } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { readPlaybook, type PlaybookRule } from '@/lib/ai-profile';
import { createAdminClient } from '@/lib/supabase/admin';

// Merchants cannot write tenants directly (status and limits are admin-only), so this whitelisted update runs
// with the service role for the caller's own shop, and readPlaybook keeps only known, length-capped fields.
export async function savePlaybook(rules: PlaybookRule[]): Promise<{ error?: string; message?: string }> {
  const { tenant, user } = await requireMerchant();
  if (tenant.status === 'suspended') return { error: 'Your shop is suspended. Contact the ChatNab team.' };

  const playbook = readPlaybook(rules);
  const { error } = await createAdminClient().from('tenants').update({ ai_playbook: playbook }).eq('id', tenant.id);
  if (error) return { error: error.message };

  await audit('merchant.ai_playbook_changed', { actorId: user.id, tenantId: tenant.id, detail: { rules: playbook.length } });
  revalidatePath('/dashboard/ai');
  return { message: `Saved. Your AI follows ${playbook.length} instruction${playbook.length === 1 ? '' : 's'} from its next reply.` };
}
