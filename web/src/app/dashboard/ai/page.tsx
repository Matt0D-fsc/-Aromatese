import { redirect } from 'next/navigation';
import { requireMerchant } from '@/lib/auth';
import { readPlaybook } from '@/lib/ai-profile';
import { card } from '@/components/ui';
import { PlaybookForm } from './playbook-form';

export default async function AiInstructionsPage() {
  const { supabase, tenant } = await requireMerchant();
  if (!tenant.onboarding_completed_at) redirect('/dashboard/onboarding');

  // requireMerchant's tenant type does not carry the playbook; one column, read under the merchant's own RLS.
  const { data } = await supabase.from('tenants').select('ai_playbook').eq('id', tenant.id).single();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">AI instructions</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Teach your AI how your shop handles things: ready answers to common questions, or steps to follow. It can look up a customer&apos;s past
          orders with you (customer_history), hand a chat to your team (request_human), and search your products. Prices always come from your
          product list, so a discount you allow here is noted on the order for your team to apply.
        </p>
      </div>
      <div className={card}>
        <PlaybookForm initial={readPlaybook(data?.ai_playbook)} />
      </div>
    </div>
  );
}
