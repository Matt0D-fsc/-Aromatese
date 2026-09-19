'use client';

import { useState } from 'react';
import { btn, btnGhost } from '@/components/ui';
import { CheckIcon } from '@/components/icons';

// Where the merchant's customers come from: the chat link in the Facebook page bio, a post, an ad, a WhatsApp
// status, and the QR code on the parcel, the shop counter or the business card.
export function ShareLink({ url, qr, shopName }: { url: string; qr: string; shopName: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Clipboard blocked: the link is in a selectable field right above. */
    }
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qr} alt={`QR code for ${shopName}'s chat`} className="h-36 w-36 shrink-0 self-center rounded-control border border-line bg-white p-1" />
      <div className="min-w-0 flex-1 space-y-2">
        <input
          readOnly
          value={url}
          aria-label="Your chat link"
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-control border border-line bg-content2 px-3 py-2 font-mono text-xs text-zinc-600"
        />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={copy} className={btn}>
            {copied ? <CheckIcon size={16} /> : null}
            {copied ? 'Copied' : 'Copy link'}
          </button>
          <a href={qr} download={`${shopName.replace(/[^\w-]+/g, '-')}-chat-qr.png`} className={btnGhost}>
            Download QR
          </a>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(`${shopName}: amader shathe chat korun, chobi ba voice note pathan: ${url}`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className={btnGhost}
          >
            Share on WhatsApp
          </a>
        </div>
        <p className="text-xs text-zinc-500">Put it in your Facebook page bio, your posts and ads. Print the QR on parcels and at your counter.</p>
      </div>
    </div>
  );
}
