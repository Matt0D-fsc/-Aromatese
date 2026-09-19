import { requireMerchant } from '@/lib/auth';
import { card } from '@/components/ui';
import { ShopForm } from './shop-form';
import { AccountForm } from './account-form';

export default async function OnboardingPage() {
  const { tenant, user } = await requireMerchant();
  const firstTime = !tenant.onboarding_completed_at;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {firstTime && (
        <ol className="flex gap-3 text-sm">
          <li className="rounded-full bg-foreground px-3 py-1 text-background">1. Shop details</li>
          <li className="rounded-full bg-zinc-200 px-3 py-1 text-zinc-600">2. Add products</li>
        </ol>
      )}
      <div>
        <h1 className="text-2xl font-semibold">{firstTime ? 'Welcome! Set up your shop' : 'Shop profile'}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {firstTime ? 'This takes a minute. Next you’ll add the products your AI sales agent will sell.' : 'Update how your shop appears to customers.'}
        </p>
      </div>
      <div className={card}>
        <ShopForm tenant={tenant} />
      </div>

      {/* Not shown during first-run setup: one thing at a time until the shop is live. */}
      {!firstTime && (
        <div className={card}>
          <h2 className="mb-1 font-semibold">Your account</h2>
          <p className="mb-4 text-sm text-zinc-500">Only you can change this. The ChatNab team never sees your password.</p>
          <AccountForm email={user.email ?? ''} />
        </div>
      )}
    </div>
  );
}
