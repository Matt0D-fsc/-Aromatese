'use client';

import { useActionState, useState } from 'react';
import { inviteMerchant } from './actions';
import { btn, errorBox, hint, input, label, noticeBox } from '@/components/ui';

export function InviteForm() {
  const [state, action, pending] = useActionState(inviteMerchant, {});
  const [method, setMethod] = useState<'create' | 'email'>('create');

  return (
    <form action={action} className="space-y-4">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="How they get in">
        {(
          [
            ['create', 'Create account now'],
            ['email', 'Email an invite'],
          ] as const
        ).map(([value, text]) => (
          <label key={value} className={`cursor-pointer rounded-chip border px-3 py-1.5 text-sm ${method === value ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line text-zinc-600'}`}>
            <input type="radio" name="method" value={value} checked={method === value} onChange={() => setMethod(value)} className="sr-only" />
            {text}
          </label>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className={label} htmlFor="shopName">Shop name</label>
          <input className={input} id="shopName" name="shopName" placeholder="Rahim Fashion House" required />
        </div>
        <div>
          <label className={label} htmlFor="email">Owner email (their login)</label>
          <input className={input} id="email" name="email" type="email" placeholder="owner@shop.com" required />
        </div>
        <div>
          <label className={label} htmlFor="limit">AI replies / month</label>
          <input className={input} id="limit" name="limit" type="number" min={0} step={1} defaultValue={1000} required />
        </div>
        {method === 'create' && (
          <div>
            <label className={label} htmlFor="password">Starting password</label>
            <input className={input} id="password" name="password" type="text" minLength={8} autoComplete="off" placeholder="Optional" />
          </div>
        )}
      </div>
      <p className={hint}>
        {method === 'create'
          ? 'No email is sent. Set a starting password to hand over yourself, or leave it blank to get a one-time link they use to choose their own.'
          : 'Supabase emails them a link. Needs working email delivery (SMTP).'}
      </p>

      <button className={btn} disabled={pending}>{pending ? 'Working…' : method === 'create' ? 'Create merchant' : 'Send invite'}</button>
      {state.error && <p className={errorBox} role="alert">{state.error}</p>}
      {state.message && <p className={noticeBox}>{state.message}</p>}
      {state.link && (
        <input
          readOnly
          value={state.link}
          aria-label="One-time sign-in link"
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-chip border border-line bg-content2 px-2 py-1 font-mono text-[11px] text-zinc-600"
        />
      )}
    </form>
  );
}
