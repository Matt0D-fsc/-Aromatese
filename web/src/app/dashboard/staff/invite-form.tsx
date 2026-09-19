'use client';

import { useActionState, useState } from 'react';
import { inviteStaff } from './actions';
import { btn, errorBox, hint, input, label, noticeBox } from '@/components/ui';

export function InviteStaffForm() {
  const [state, action, pending] = useActionState(inviteStaff, {});
  const [method, setMethod] = useState<'create' | 'email'>('create');

  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="How they get in">
        {(
          [
            ['create', 'Create their login now'],
            ['email', 'Email an invite'],
          ] as const
        ).map(([value, text]) => (
          <label key={value} className={`cursor-pointer rounded-chip border px-3 py-1.5 text-sm ${method === value ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line text-zinc-600'}`}>
            <input type="radio" name="method" value={value} checked={method === value} onChange={() => setMethod(value)} className="sr-only" />
            {text}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <label className={label} htmlFor="staff-email">
            Their email (their login)
          </label>
          <input className={input} id="staff-email" name="email" type="email" placeholder="assistant@example.com" required />
        </div>
        {method === 'create' && (
          <div className="min-w-44">
            <label className={label} htmlFor="staff-password">
              Starting password
            </label>
            <input className={input} id="staff-password" name="password" type="text" minLength={8} autoComplete="off" placeholder="Optional" />
          </div>
        )}
        <button className={btn} disabled={pending}>
          {pending ? 'Working…' : method === 'create' ? 'Add to team' : 'Send invite'}
        </button>
      </div>
      <p className={hint}>
        {method === 'create'
          ? 'No email is sent. Set a starting password to give them yourself, or leave it blank to get a one-time link they use to choose their own.'
          : 'They get an email with a link to set their own password.'}
      </p>
      {state.error && (
        <p className={errorBox} role="alert">
          {state.error}
        </p>
      )}
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
