'use client';

import { useActionState, useState } from 'react';
import type { Tenant } from '@/lib/auth';
import { saveShopProfile } from './actions';
import { POLICY_FIELDS } from '@/lib/policies';
import { createClient } from '@/lib/supabase/client';
import { btn, btnGhost, errorBox, hint, input, label } from '@/components/ui';

const CATEGORIES = ['Fashion & clothing', 'Watches & accessories', 'Electronics', 'Beauty & cosmetics', 'Home & living', 'Food & grocery', 'Other'];

export function ShopForm({ tenant }: { tenant: Tenant }) {
  const [state, action, pending] = useActionState(saveShopProfile, {});
  const [logoUrl, setLogoUrl] = useState(tenant.logo_url ?? '');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // Straight to storage from the browser, the same way product photos go. The path starts with this shop's id,
  // which is what the bucket policy checks, and what the server re-checks before saving the URL.
  async function uploadLogo(file: File) {
    if (file.size > 2 * 1024 * 1024) return setUploadError('Logo must be under 2 MB.');
    setUploading(true);
    setUploadError('');
    const supabase = createClient();
    const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const path = `${tenant.id}/logo/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from('product-images').upload(path, file, { contentType: file.type });
    setUploading(false);
    if (error) return setUploadError(error.message);
    setLogoUrl(supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl);
  }
  const firstTime = !tenant.onboarding_completed_at;
  const policies = tenant.policies ?? {};

  return (
    <form action={action} className="space-y-5">
      <div>
        <label className={label} htmlFor="name">Shop name</label>
        <input className={input} id="name" name="name" defaultValue={tenant.name} required maxLength={255} />
        <p className={hint}>Customers see this name when the AI introduces your shop.</p>
      </div>

      <div>
        <span className={label}>Logo</span>
        <input type="hidden" name="logoUrl" value={logoUrl} />
        <div className="flex items-center gap-3">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="Your shop logo" className="h-full w-full object-cover" />
            ) : (
              <span className="text-xs text-zinc-400">None</span>
            )}
          </div>
          <label className={`${btnGhost} cursor-pointer`}>
            {uploading ? 'Uploading…' : logoUrl ? 'Change' : 'Upload'}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadLogo(file);
                e.target.value = '';
              }}
            />
          </label>
          {logoUrl && (
            <button type="button" className="text-sm text-zinc-500 hover:text-red-600" onClick={() => setLogoUrl('')}>
              Remove
            </button>
          )}
        </div>
        <p className={hint}>Shown at the top of your chat, above every conversation with a customer.</p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="contactPhone">Contact phone</label>
          <input className={input} id="contactPhone" name="contactPhone" type="tel" defaultValue={tenant.contact_phone ?? ''} placeholder="01712345678" required />
        </div>
        <div>
          <label className={label} htmlFor="businessCategory">What do you sell?</label>
          <select className={input} id="businessCategory" name="businessCategory" defaultValue={tenant.business_category ?? ''} required>
            <option value="" disabled>Choose a category</option>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className={label} htmlFor="address">Pickup / business address</label>
        <textarea className={input} id="address" name="address" rows={2} defaultValue={tenant.address ?? ''} placeholder="House 12, Road 5, Dhanmondi, Dhaka" />
        <p className={hint}>Optional. Used later for courier pickup.</p>
      </div>
      <fieldset className="space-y-5 border-t border-zinc-200 pt-5">
        <legend className="sr-only">Shop policies</legend>
        <div>
          <h2 className="font-medium">What your AI is allowed to promise</h2>
          <p className={hint}>
            Your AI never guesses. Fill these in and it answers instantly; leave one blank and it says you will confirm that by phone.
          </p>
        </div>
        {POLICY_FIELDS.map((field) => (
          <div key={field.key}>
            <label className={label} htmlFor={field.key}>
              {field.label}
            </label>
            {'textarea' in field && field.textarea ? (
              <textarea className={input} id={field.key} name={field.key} rows={2} maxLength={500} defaultValue={policies[field.key] ?? ''} placeholder={field.placeholder} />
            ) : (
              <input className={input} id={field.key} name={field.key} maxLength={500} defaultValue={policies[field.key] ?? ''} placeholder={field.placeholder} />
            )}
            {'hint' in field && field.hint && <p className={hint}>{field.hint}</p>}
          </div>
        ))}
      </fieldset>

      {(state.error || uploadError) && <p className={errorBox} role="alert">{state.error || uploadError}</p>}
      <button className={btn} disabled={pending}>
        {pending ? 'Saving…' : firstTime ? 'Continue to products →' : 'Save changes'}
      </button>
    </form>
  );
}
