'use client';

import { useActionState } from 'react';
import { inviteMerchant } from './actions';
import { btn, errorBox, input, label, noticeBox } from '@/components/ui';

export function InviteForm() {
  const [state, action, pending] = useActionState(inviteMerchant, {});

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-[1fr_1fr_10rem_auto] sm:items-end">
      <div>
        <label className={label} htmlFor="shopName">Shop name</label>
        <input className={input} id="shopName" name="shopName" placeholder="Rahim Fashion House" required />
      </div>
      <div>
        <label className={label} htmlFor="email">Owner email</label>
        <input className={input} id="email" name="email" type="email" placeholder="owner@shop.com" required />
      </div>
      <div>
        <label className={label} htmlFor="limit">Messages / month</label>
        <input className={input} id="limit" name="limit" type="number" min={0} step={1} defaultValue={1000} required />
      </div>
      <button className={btn} disabled={pending}>{pending ? 'Sending…' : 'Send invite'}</button>
      {state.error && <p className={`${errorBox} sm:col-span-4`} role="alert">{state.error}</p>}
      {state.message && <p className={`${noticeBox} sm:col-span-4`}>{state.message}</p>}
    </form>
  );
}
