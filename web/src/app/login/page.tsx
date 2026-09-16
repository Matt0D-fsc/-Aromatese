'use client';

import { useActionState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { sendPasswordReset, signIn } from './actions';
import { btn, card, errorBox, input, label, noticeBox } from '@/components/ui';

function LoginForms() {
  const [signInState, signInAction, signingIn] = useActionState(signIn, {});
  const [resetState, resetAction, resetting] = useActionState(sendPasswordReset, {});
  const noShop = useSearchParams().get('error') === 'no-shop';

  return (
    <div className={`${card} w-full max-w-sm space-y-6`}>
      <div>
        <h1 className="text-xl font-semibold">Sign in to ChatNab</h1>
        <p className="mt-1 text-sm text-zinc-500">Accounts are invite only.</p>
      </div>

      {noShop && <p className={errorBox}>Your account isn&apos;t linked to a shop yet. Contact the ChatNab team.</p>}

      <form action={signInAction} className="space-y-4">
        <div>
          <label className={label} htmlFor="email">Email</label>
          <input className={input} id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div>
          <label className={label} htmlFor="password">Password</label>
          <input className={input} id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        {signInState.error && <p className={errorBox} role="alert">{signInState.error}</p>}
        <button className={`${btn} w-full`} disabled={signingIn}>{signingIn ? 'Signing in…' : 'Sign in'}</button>
      </form>

      <details className="text-sm">
        <summary className="cursor-pointer text-zinc-600 hover:text-zinc-900">Forgot password?</summary>
        <form action={resetAction} className="mt-3 space-y-3">
          <input className={input} name="email" type="email" placeholder="you@shop.com" aria-label="Email for reset link" required />
          {resetState.message && <p className={noticeBox}>{resetState.message}</p>}
          {resetState.error && <p className={errorBox}>{resetState.error}</p>}
          <button className={`${btn} w-full`} disabled={resetting}>Send reset link</button>
        </form>
      </details>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Suspense>
        <LoginForms />
      </Suspense>
    </main>
  );
}
