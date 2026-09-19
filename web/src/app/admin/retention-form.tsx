'use client';

import { useActionState } from 'react';
import { purgeOldChats } from './actions';
import { btnDanger, errorBox, hint, input, noticeBox } from '@/components/ui';

export function RetentionForm() {
  const [state, action, pending] = useActionState(purgeOldChats, {});

  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700" htmlFor="days">
            Delete chats older than
          </label>
          <div className="flex items-center gap-2">
            <input className={`${input} w-28`} id="days" name="days" type="number" min={7} step={1} defaultValue={180} required />
            <span className="text-sm text-zinc-600">days</span>
          </div>
        </div>
        <button className={btnDanger} disabled={pending}>
          {pending ? 'Deleting…' : 'Delete now'}
        </button>
      </div>
      <p className={hint}>
        Removes the conversations, their messages and the voice notes and photos attached to them. Orders, products and
        customer records are kept. This cannot be undone.
      </p>
      {state.error && (
        <p className={errorBox} role="alert">
          {state.error}
        </p>
      )}
      {state.message && <p className={noticeBox}>{state.message}</p>}
    </form>
  );
}
