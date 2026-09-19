'use client';

import { useActionState } from 'react';
import { inviteStaff } from './actions';
import { btn, errorBox, hint, input, label, noticeBox } from '@/components/ui';

export function InviteStaffForm() {
  const [state, action, pending] = useActionState(inviteStaff, {});

  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <label className={label} htmlFor="staff-email">
            Their email
          </label>
          <input className={input} id="staff-email" name="email" type="email" placeholder="assistant@example.com" required />
        </div>
        <button className={btn} disabled={pending}>
          {pending ? 'Sending…' : 'Send invite'}
        </button>
      </div>
      <p className={hint}>They get an email with a link to set their own password. Nothing is shared with them until they do.</p>
      {state.error && (
        <p className={errorBox} role="alert">
          {state.error}
        </p>
      )}
      {state.message && <p className={noticeBox}>{state.message}</p>}
    </form>
  );
}
