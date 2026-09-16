'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { btn, card, errorBox, input, label } from '@/components/ui';

// Landing page for invite and password-reset emails. Invite links carry tokens in the URL #hash,
// which never reaches the server, so the session is established here in the browser.
export default function SetPasswordPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<'checking' | 'ready' | 'saving' | 'invalid'>('checking');
  const [error, setError] = useState('');

  useEffect(() => {
    // Created here, not during render: the page is prerendered at build time, when no Supabase env exists.
    const supabase = createClient();
    (async () => {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const query = new URLSearchParams(window.location.search);
      let linkError: { message: string } | null = null;

      if (hash.get('error_description')) {
        linkError = { message: hash.get('error_description')! };
      } else if (hash.get('access_token') && hash.get('refresh_token')) {
        ({ error: linkError } = await supabase.auth.setSession({
          access_token: hash.get('access_token')!,
          refresh_token: hash.get('refresh_token')!,
        }));
      } else if (query.get('token_hash')) {
        ({ error: linkError } = await supabase.auth.verifyOtp({
          type: (query.get('type') ?? 'invite') as EmailOtpType,
          token_hash: query.get('token_hash')!,
        }));
      } else if (query.get('code')) {
        ({ error: linkError } = await supabase.auth.exchangeCodeForSession(query.get('code')!));
      }

      // Don't leave tokens sitting in the address bar or browser history.
      window.history.replaceState(null, '', window.location.pathname);

      const { data } = await supabase.auth.getUser();
      if (linkError || !data.user) {
        setError(linkError?.message ?? 'This link is invalid or has expired. Ask for a new invite.');
        setPhase('invalid');
      } else {
        setPhase('ready');
      }
    })();
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get('password') ?? '');
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (password !== fd.get('confirm')) return setError('Passwords do not match.');

    setError('');
    setPhase('saving');
    const { error: updateError } = await createClient().auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setPhase('ready');
      return;
    }
    router.replace('/');
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className={`${card} w-full max-w-sm space-y-5`}>
        <h1 className="text-xl font-semibold">Set your password</h1>

        {phase === 'checking' && <p className="text-sm text-zinc-500">Checking your link…</p>}
        {phase === 'invalid' && <p className={errorBox}>{error}</p>}

        {(phase === 'ready' || phase === 'saving') && (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className={label} htmlFor="password">New password</label>
              <input className={input} id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
            </div>
            <div>
              <label className={label} htmlFor="confirm">Confirm password</label>
              <input className={input} id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} required />
            </div>
            {error && <p className={errorBox} role="alert">{error}</p>}
            <button className={`${btn} w-full`} disabled={phase === 'saving'}>
              {phase === 'saving' ? 'Saving…' : 'Save and continue'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
