'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { btnGhost, errorBox, hint, input, label, noticeBox } from '@/components/ui';

// A merchant who wants a new password should not have to wait for an email, which is the one part of this
// system that does not reliably arrive. They are already signed in, so Supabase will take the change directly.
export function AccountForm({ email }: { email: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const password = String(data.get('password') ?? '');

    if (password.length < 8) return setError('Use at least 8 characters.');
    if (password !== data.get('confirm')) return setError('The two passwords do not match.');

    setError('');
    setDone(false);
    setBusy(true);
    const { error: updateError } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (updateError) return setError(updateError.message);
    form.reset();
    setDone(true);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-sm text-zinc-500">
        Signed in as <span className="font-medium text-foreground">{email}</span>
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="password">
            New password
          </label>
          <input className={input} id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
        </div>
        <div>
          <label className={label} htmlFor="confirm">
            Confirm it
          </label>
          <input className={input} id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} required />
        </div>
      </div>
      <p className={hint}>At least 8 characters. You stay signed in on this device.</p>

      {error && (
        <p className={errorBox} role="alert">
          {error}
        </p>
      )}
      {done && <p className={noticeBox}>Password changed.</p>}

      <button className={btnGhost} disabled={busy}>
        {busy ? 'Saving…' : 'Change password'}
      </button>
    </form>
  );
}
