'use client';

import { useActionState } from 'react';
import type { Tenant } from '@/lib/auth';
import { saveShopProfile } from './actions';
import { btn, errorBox, hint, input, label } from '@/components/ui';

const CATEGORIES = ['Fashion & clothing', 'Watches & accessories', 'Electronics', 'Beauty & cosmetics', 'Home & living', 'Food & grocery', 'Other'];

export function ShopForm({ tenant }: { tenant: Tenant }) {
  const [state, action, pending] = useActionState(saveShopProfile, {});
  const firstTime = !tenant.onboarding_completed_at;

  return (
    <form action={action} className="space-y-5">
      <div>
        <label className={label} htmlFor="name">Shop name</label>
        <input className={input} id="name" name="name" defaultValue={tenant.name} required maxLength={255} />
        <p className={hint}>Customers see this name when the AI introduces your shop.</p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="contactPhone">Contact phone</label>
          <input className={input} id="contactPhone" name="contactPhone" type="tel" defaultValue={tenant.contact_phone ?? ''} placeholder="01712345678" required />
        </div>
        <div>
          <label className={label} htmlFor="businessCategory">What do you sell?</label>
          <select className={input} id="businessCategory" name="businessCategory" defaultValue={tenant.business_category ?? ''} required>
            <option value="" disabled>Choose a category</option>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className={label} htmlFor="address">Pickup / business address</label>
        <textarea className={input} id="address" name="address" rows={2} defaultValue={tenant.address ?? ''} placeholder="House 12, Road 5, Dhanmondi, Dhaka" />
        <p className={hint}>Optional. Used later for courier pickup.</p>
      </div>
      {state.error && <p className={errorBox} role="alert">{state.error}</p>}
      <button className={btn} disabled={pending}>
        {pending ? 'Saving…' : firstTime ? 'Continue to products →' : 'Save changes'}
      </button>
    </form>
  );
}
