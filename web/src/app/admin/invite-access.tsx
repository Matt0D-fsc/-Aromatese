'use client';

import { useState, useTransition } from 'react';
import { createInviteLink, revokeInvite } from './actions';
import { btnDanger, btnGhost, errorBox, noticeBox } from '@/components/ui';
import { CheckIcon } from '@/components/icons';

// Getting a merchant in should not depend on an email arriving. This hands the admin the same one-time link
// the email would have contained, to send however they actually reach that shop — in Bangladesh, usually
// WhatsApp. The merchant still chooses their own password at the other end.
export function InviteAccess({ tenantId, neverSignedIn }: { tenantId: string; neverSignedIn: boolean }) {
  const [link, setLink] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, start] = useTransition();

  function makeLink() {
    setError('');
    setMessage('');
    start(async () => {
      const res = await createInviteLink(tenantId);
      if (res.error) return setError(res.error);
      setLink(res.link ?? '');
      setMessage(`One-time link for ${res.shopName ?? 'this shop'} (${res.email}). It expires, so send it now, and open it in a private window if you test it yourself.`);
    });
  }

  function revoke() {
    if (!confirm('Revoke this invite? The shop and its unused account are deleted. This cannot be undone.')) return;
    setError('');
    setMessage('');
    start(async () => {
      const res = await revokeInvite(tenantId);
      if (res.error) return setError(res.error);
      setMessage(res.message ?? 'Revoked.');
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy. Select the link and copy it by hand.');
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={makeLink} disabled={busy} className={`${btnGhost} min-h-9 px-2.5 text-xs`}>
          {busy ? 'Working…' : link ? 'New link' : 'Get sign-in link'}
        </button>
        {neverSignedIn && (
          <button type="button" onClick={revoke} disabled={busy} className={`${btnDanger} min-h-9 px-2.5 text-xs`}>
            Revoke
          </button>
        )}
      </div>

      {link && (
        <div className="flex items-center gap-1.5">
          {/* Readonly rather than plain text: it stays selectable if the clipboard is blocked. */}
          <input
            readOnly
            value={link}
            aria-label="One-time sign-in link"
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 rounded-chip border border-line bg-content2 px-2 py-1 font-mono text-[11px] text-zinc-600"
          />
          <button type="button" onClick={copy} className={`${btnGhost} min-h-9 shrink-0 px-2.5 text-xs`}>
            {copied ? <CheckIcon size={14} /> : 'Copy'}
          </button>
        </div>
      )}

      {message && <p className={`${noticeBox} text-xs`}>{message}</p>}
      {error && <p className={`${errorBox} text-xs`} role="alert">{error}</p>}
    </div>
  );
}
