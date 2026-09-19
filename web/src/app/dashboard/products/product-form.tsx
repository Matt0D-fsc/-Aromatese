'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { autofillProduct, deleteProduct, saveProduct } from './actions';
import type { ProductInput } from './product-input';
import { btn, btnDanger, btnGhost, card, errorBox, hint, input, label, noticeBox } from '@/components/ui';

const MAX_PHOTOS = 10;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

type TextKey = { [K in keyof ProductInput]: ProductInput[K] extends string ? K : never }[keyof ProductInput];

export function ProductForm({ tenantId, product, isNew }: { tenantId: string; product: ProductInput; isNew: boolean }) {
  const [form, setForm] = useState(product);
  const [tagDraft, setTagDraft] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [uploading, setUploading] = useState(false);
  const [autofilling, setAutofilling] = useState(false);
  const [saving, startSaving] = useTransition();

  const bind = (key: TextKey) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  async function uploadPhotos(files: FileList | null) {
    const room = MAX_PHOTOS - form.imageUrls.length;
    const picked = Array.from(files ?? []).filter((f) => f.type.startsWith('image/'));
    if (!picked.length) return;
    if (room <= 0) return setError(`You can add up to ${MAX_PHOTOS} photos.`);

    setUploading(true);
    setError('');
    const supabase = createClient();
    const urls: string[] = [];
    for (const file of picked.slice(0, room)) {
      if (file.size > MAX_PHOTO_BYTES) {
        setError(`${file.name} is larger than 5 MB.`);
        continue;
      }
      const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const path = `${tenantId}/${form.id}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('product-images').upload(path, file, { contentType: file.type });
      if (uploadError) {
        setError(uploadError.message);
        continue;
      }
      urls.push(supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl);
    }
    setForm((f) => ({ ...f, imageUrls: [...f.imageUrls, ...urls] }));
    setUploading(false);
  }

  const setVariant = (index: number, patch: Partial<ProductInput['variants'][number]>) =>
    setForm((f) => ({ ...f, variants: f.variants.map((v, i) => (i === index ? { ...v, ...patch } : v)) }));

  // ponytail: removing a photo only unlinks it; the file is cleaned up when the product is deleted.
  const removePhoto = (url: string) => setForm((f) => ({ ...f, imageUrls: f.imageUrls.filter((u) => u !== url) }));
  const makeCover = (url: string) => setForm((f) => ({ ...f, imageUrls: [url, ...f.imageUrls.filter((u) => u !== url)] }));

  function addTags(raw: string) {
    const tags = raw.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (tags.length) setForm((f) => ({ ...f, voiceTags: [...new Set([...f.voiceTags, ...tags])] }));
    setTagDraft('');
  }

  async function runAutofill() {
    setAutofilling(true);
    setError('');
    setNotice('');
    const res = await autofillProduct(form.titleEn);
    setAutofilling(false);
    if ('error' in res) return setError(res.error);
    const d = res.data;
    setForm((f) => ({
      ...f,
      titleBn: d.titleBn || f.titleBn,
      titleBanglish: d.titleBanglish || f.titleBanglish,
      brand: f.brand || d.brand,
      category: f.category || d.category,
      customNotes: f.customNotes || d.customNotes,
      voiceTags: [...new Set([...f.voiceTags, ...d.voiceTags.map((t) => t.toLowerCase())])],
    }));
    setNotice('AI filled in titles, tags and notes. Check them before saving. Price and stock are always set by you.');
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    startSaving(async () => {
      const res = await saveProduct(form);
      if (res?.error) setError(res.error);
    });
  }

  function onDelete() {
    if (!confirm('Delete this product and its photos? This cannot be undone.')) return;
    startSaving(async () => {
      const res = await deleteProduct(form.id);
      if (res?.error) setError(res.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/dashboard" className="text-sm text-zinc-500 hover:text-zinc-900">← Products</Link>
          <h1 className="text-2xl font-semibold">{isNew ? 'Add a product' : form.titleEn || 'Edit product'}</h1>
        </div>
        <div className="flex gap-2">
          {!isNew && <button type="button" className={btnDanger} onClick={onDelete} disabled={saving}>Delete</button>}
          <button className={btn} disabled={saving || uploading}>{saving ? 'Saving…' : 'Save product'}</button>
        </div>
      </div>

      {error && <p className={errorBox} role="alert">{error}</p>}
      {notice && <p className={noticeBox}>{notice}</p>}

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-6">
          <section className={card}>
            <h2 className="mb-1 font-semibold">Photos</h2>
            <p className={`${hint} mb-4`}>The first photo is the cover. The AI sends these to customers and uses them to recognise products from customer photos.</p>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {form.imageUrls.map((url, i) => (
                <div key={url} className="group relative aspect-square overflow-hidden rounded-chip border border-line bg-zinc-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Product photo ${i + 1}`} className="h-full w-full object-cover" />
                  {i === 0 && <span className="absolute left-1 top-1 rounded-chip bg-foreground/80 px-1.5 py-0.5 text-[10px] text-background">Cover</span>}
                  <div className="absolute inset-x-1 bottom-1 flex justify-between gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                    {i !== 0 && (
                      <button type="button" onClick={() => makeCover(url)} className="rounded-chip bg-surface/90 px-1.5 py-0.5 text-[10px] font-medium">Cover</button>
                    )}
                    <button type="button" onClick={() => removePhoto(url)} className="ml-auto rounded-chip bg-surface/90 px-1.5 py-0.5 text-[10px] font-medium text-danger-strong">Remove</button>
                  </div>
                </div>
              ))}
              {form.imageUrls.length < MAX_PHOTOS && (
                <label className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-chip border-2 border-dashed border-zinc-300 text-center text-xs text-zinc-500 hover:border-zinc-500 hover:text-zinc-800">
                  <span className="text-2xl leading-none">+</span>
                  {uploading ? 'Uploading…' : 'Add photos'}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="sr-only"
                    disabled={uploading}
                    onChange={(e) => {
                      uploadPhotos(e.target.files);
                      e.target.value = '';
                    }}
                  />
                </label>
              )}
            </div>
          </section>

          <section className={`${card} space-y-4`}>
            <h2 className="font-semibold">Details</h2>
            <div>
              <label className={label} htmlFor="titleEn">Title (English)</label>
              <div className="flex gap-2">
                <input className={input} id="titleEn" {...bind('titleEn')} placeholder="Blue Cotton Midi Dress" required maxLength={255} />
                <button type="button" className={`${btnGhost} shrink-0`} onClick={runAutofill} disabled={autofilling || !form.titleEn.trim()}>
                  {autofilling ? 'Thinking…' : '✨ AI fill'}
                </button>
              </div>
              <p className={hint}>Type the English title, then let AI fill the Bangla title, Banglish title and search tags.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={label} htmlFor="titleBn">Title (বাংলা)</label>
                <input className={input} id="titleBn" {...bind('titleBn')} placeholder="নীল সুতি মিডি ড্রেস" maxLength={255} />
              </div>
              <div>
                <label className={label} htmlFor="titleBanglish">Title (Banglish)</label>
                <input className={input} id="titleBanglish" {...bind('titleBanglish')} placeholder="neel suti midi dress" maxLength={255} />
              </div>
              <div>
                <label className={label} htmlFor="brand">Brand</label>
                <input className={input} id="brand" {...bind('brand')} maxLength={255} />
              </div>
              <div>
                <label className={label} htmlFor="category">Category</label>
                <input className={input} id="category" list="category-options" {...bind('category')} maxLength={100} />
                <datalist id="category-options">
                  {['Dress', 'Saree', 'Panjabi', 'Shirt', 'Shoes', 'Watch', 'Bag', 'Jewellery', 'Cosmetics', 'Electronics'].map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
            </div>
            <div>
              <label className={label} htmlFor="description">Description</label>
              <textarea className={input} id="description" rows={3} {...bind('description')} placeholder="Size, fabric, fit, what's included…" />
            </div>
          </section>

          <section className={`${card} space-y-4`}>
            <div>
              <h2 className="font-semibold">Sizes and colours</h2>
              <p className={hint}>
                Optional. Add one row per size or colour and the AI can answer &ldquo;ei size ta ache?&rdquo; itself. Leave the price blank to use the
                product price.
              </p>
            </div>
            {form.variants.length > 0 && (
              <ul className="space-y-2">
                {form.variants.map((v, i) => (
                  <li key={i} className="grid grid-cols-[1fr_6rem_5rem_2rem] gap-2">
                    <input
                      className={input}
                      value={v.name}
                      onChange={(e) => setVariant(i, { name: e.target.value })}
                      placeholder="M / Red"
                      aria-label={`Size or colour ${i + 1}`}
                      maxLength={100}
                    />
                    <input
                      className={input}
                      value={v.priceBdt}
                      onChange={(e) => setVariant(i, { priceBdt: e.target.value })}
                      type="number"
                      min={0}
                      placeholder="Price"
                      aria-label={`Price for ${v.name || `size ${i + 1}`}`}
                    />
                    <input
                      className={input}
                      value={v.stockQuantity}
                      onChange={(e) => setVariant(i, { stockQuantity: e.target.value })}
                      type="number"
                      min={0}
                      placeholder="Stock"
                      aria-label={`Stock for ${v.name || `size ${i + 1}`}`}
                    />
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, variants: f.variants.filter((_, x) => x !== i) }))}
                      className="rounded-control text-zinc-400 hover:bg-zinc-100 hover:text-danger"
                      aria-label={`Remove ${v.name || `size ${i + 1}`}`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className={btnGhost}
              onClick={() => setForm((f) => ({ ...f, variants: [...f.variants, { name: '', priceBdt: '', stockQuantity: '0' }] }))}
            >
              + Add a size or colour
            </button>
          </section>
        </div>

        <div className="space-y-6">
          <section className={`${card} space-y-4`}>
            <h2 className="font-semibold">Price &amp; stock</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={label} htmlFor="priceBdt">Price (৳)</label>
                <input className={input} id="priceBdt" type="number" min={0} step="0.01" inputMode="decimal" {...bind('priceBdt')} required />
              </div>
              <div>
                <label className={label} htmlFor="discountPriceBdt">Sale price (৳)</label>
                <input className={input} id="discountPriceBdt" type="number" min={0} step="0.01" inputMode="decimal" {...bind('discountPriceBdt')} placeholder="Optional" />
              </div>
              <div>
                <label className={label} htmlFor="stockQuantity">Stock</label>
                <input className={input} id="stockQuantity" type="number" min={0} step={1} inputMode="numeric" {...bind('stockQuantity')} required />
              </div>
              <div>
                <label className={label} htmlFor="sku">SKU</label>
                <input className={input} id="sku" {...bind('sku')} placeholder="Auto" maxLength={100} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} className="h-4 w-4 accent-zinc-900" />
              Available for the AI to sell
            </label>
          </section>

          <section className={`${card} space-y-4`}>
            <div>
              <h2 className="font-semibold">Search &amp; voice tags</h2>
              <p className={hint}>Words customers say or type for this product, like ghori, neel or suti. They help the AI match voice notes and Banglish messages.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {form.voiceTags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-xs">
                  {t}
                  <button
                    type="button"
                    aria-label={`Remove tag ${t}`}
                    onClick={() => setForm((f) => ({ ...f, voiceTags: f.voiceTags.filter((x) => x !== t) }))}
                    className="text-zinc-400 hover:text-zinc-900"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <input
              className={input}
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addTags(tagDraft);
                }
              }}
              onBlur={() => addTags(tagDraft)}
              placeholder="Type a tag and press Enter"
              aria-label="Add tag"
            />
          </section>

          <section className={`${card} space-y-2`}>
            <label className={`${label} font-semibold`} htmlFor="customNotes">Notes for the AI</label>
            <textarea className={input} id="customNotes" rows={4} {...bind('customNotes')} placeholder="Selling points, care instructions, who it's for…" />
            <p className={hint}>The AI uses these when describing the product. Don&apos;t put prices here; it always reads price and stock live.</p>
          </section>
        </div>
      </div>
    </form>
  );
}
