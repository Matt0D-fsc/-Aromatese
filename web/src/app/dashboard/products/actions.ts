'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireMerchant } from '@/lib/auth';
import { audit, throwAudited } from '@/lib/audit';
import { GEMINI_MODEL, generateContent } from '@/lib/gemini';
import type { ProductInput } from './product-input';

const BUCKET = 'product-images';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUSPENDED = { error: 'Your shop is suspended. Contact the ChatNab team.' };

export async function saveProduct(input: ProductInput): Promise<{ error: string } | undefined> {
  const { supabase, tenant } = await requireMerchant();
  if (tenant.status === 'suspended') return SUSPENDED;

  const price = Number(input.priceBdt);
  const discount = input.discountPriceBdt === '' ? null : Number(input.discountPriceBdt);
  const stock = Number(input.stockQuantity);
  const titleEn = String(input.titleEn ?? '').trim();

  if (!UUID.test(input.id)) return { error: 'Invalid product.' };
  if (!titleEn) return { error: 'English title is required.' };
  if (input.priceBdt === '' || !Number.isFinite(price) || price < 0) return { error: 'Enter a valid price.' };
  if (discount !== null && (!Number.isFinite(discount) || discount < 0 || discount >= price)) {
    return { error: 'Discount price must be lower than the regular price.' };
  }
  if (input.stockQuantity === '' || !Number.isInteger(stock) || stock < 0) return { error: 'Stock must be a whole number (0 or more).' };

  // Photos must live in this shop's own folder for this product; anything else is rejected.
  const photoPrefix = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${tenant.id}/${input.id}/`;
  const imageUrls = Array.isArray(input.imageUrls) ? input.imageUrls : [];
  if (imageUrls.length > 10 || imageUrls.some((u) => typeof u !== 'string' || !u.startsWith(photoPrefix))) {
    return { error: 'Invalid product photos. Re-upload and try again.' };
  }

  const voiceTags = [...new Set((Array.isArray(input.voiceTags) ? input.voiceTags : []).map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 30);
  const text = (v: string) => String(v ?? '').trim() || null;

  // Variants are validated before the product is written. Doing it afterwards meant a bad size could return an
  // error with the product's price and stock already changed.
  const sku = text(input.sku) ?? `SKU-${input.id.slice(0, 8).toUpperCase()}`;
  const variants = (Array.isArray(input.variants) ? input.variants : [])
    .map((v) => ({
      name: String(v?.name ?? '').trim().slice(0, 100),
      // Blank stays null: search_products coalesces it to the product's price, so the variant follows a later
      // price change instead of freezing a copy of today's.
      price_bdt: v?.priceBdt === '' || v?.priceBdt == null ? null : Number(v.priceBdt),
      stock_quantity: Math.floor(Number(v?.stockQuantity)),
    }))
    .filter((v) => v.name)
    .slice(0, 50);

  if (variants.some((v) => (v.price_bdt !== null && (!Number.isFinite(v.price_bdt) || v.price_bdt < 0)) || !Number.isInteger(v.stock_quantity) || v.stock_quantity < 0)) {
    return { error: 'Each size or colour needs a whole-number stock, and a price of 0 or more if you set one.' };
  }
  if (new Set(variants.map((v) => v.name.toLowerCase())).size !== variants.length) {
    return { error: 'Two sizes or colours have the same name. Give each one a different name.' };
  }

  // RLS enforces tenant ownership: updating another shop's product id fails the policy check.
  const { error } = await supabase.from('products').upsert({
    id: input.id,
    tenant_id: tenant.id,
    sku,
    title_en: titleEn,
    title_bn: text(input.titleBn),
    title_banglish: text(input.titleBanglish),
    brand: text(input.brand),
    category: text(input.category),
    description: text(input.description),
    custom_notes: text(input.customNotes),
    price_bdt: price,
    discount_price_bdt: discount,
    stock_quantity: stock,
    is_active: Boolean(input.isActive),
    voice_tags: voiceTags,
    image_urls: imageUrls,
    image_url: imageUrls[0] ?? null,
    updated_at: new Date().toISOString(),
  });
  if (error) return { error: error.code === '23505' ? 'Another product already uses this SKU.' : error.message };

  // Replaced wholesale rather than diffed, but inside one function so a failed insert cannot leave the product
  // with the old variants already deleted.
  const { error: variantError } = await supabase.rpc('save_product_variants', {
    pid: input.id,
    tid: tenant.id,
    rows: variants.map((v) => ({ ...v, sku: `${sku}-${v.name.replace(/\s+/g, '-').toUpperCase().slice(0, 20)}` })),
  });
  if (variantError) return { error: variantError.message };

  revalidatePath('/dashboard', 'layout');
  redirect('/dashboard/products');
}

// Today's stock from the list, without opening the product. Only for products without sizes: those keep stock
// per variant, and a single number here would disagree with them.
export async function updateStock(id: string, formData: FormData) {
  const { supabase, tenant, user } = await requireMerchant();
  if (tenant.status === 'suspended') throw new Error('Your shop is suspended.');
  const stock = Number(formData.get('stock'));
  if (!UUID.test(id) || !Number.isInteger(stock) || stock < 0) throw new Error('Stock must be a whole number (0 or more).');

  const { error } = await supabase
    .from('products')
    .update({ stock_quantity: stock, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenant.id);
  if (error) await throwAudited('product.stock', error, { actorId: user.id, tenantId: tenant.id, detail: { productId: id, stock } });
  await audit('product.stock_changed', { actorId: user.id, tenantId: tenant.id, detail: { productId: id, stock } });
  revalidatePath('/dashboard/products');
}

export async function deleteProduct(id: string): Promise<{ error: string } | undefined> {
  const { supabase, tenant, user } = await requireMerchant();
  if (tenant.status === 'suspended') return SUSPENDED;
  if (!UUID.test(id)) return { error: 'Invalid product.' };

  const folder = `${tenant.id}/${id}`;
  const { data: files } = await supabase.storage.from(BUCKET).list(folder);
  if (files?.length) await supabase.storage.from(BUCKET).remove(files.map((f) => `${folder}/${f.name}`));

  const { error } = await supabase.from('products').delete().eq('id', id).eq('tenant_id', tenant.id);
  if (error) return { error: error.message };
  await audit('product.deleted', { actorId: user.id, tenantId: tenant.id, detail: { productId: id, files: files?.length ?? 0 } });

  revalidatePath('/dashboard', 'layout');
  redirect('/dashboard/products');
}

export type AutofillResult = {
  titleEn: string;
  titleBn: string;
  titleBanglish: string;
  brand: string;
  category: string;
  description: string;
  voiceTags: string[];
  customNotes: string;
};

const AUTOFILL_PROMPT = `You are a product catalog assistant for shops in Bangladesh.
You are given a product's photos, its English title, or both. Read whatever you are given and return JSON only:
{
  "titleEn": "short English title, 3-6 words; if a title was given, repeat it unchanged",
  "titleBn": "natural Bengali-script title",
  "titleBanglish": "how Bangladeshi customers would type it in Roman letters",
  "brand": "brand if named in the title or legible in a photo, else empty string",
  "category": "short product category",
  "description": "one or two sentences describing only what is visible: type, colour, pattern, material, neckline, sleeve, closure",
  "voiceTags": ["8-15 lowercase words customers might say or type: Bangla, Banglish and English synonyms, colors, materials"],
  "customNotes": "one or two honest selling points that follow from what you can see; never invent specs, prices, discounts or stock"
}
Describe only what is actually in the photo. Never guess a size, a fabric weight, a measurement or a brand that is not legible.
Only use apparel words (kapor, suti) for clothing. For watches include words like ghori, watch, হাত ঘড়ি.`;

const MAX_AUTOFILL_PHOTOS = 2;
const MAX_AUTOFILL_BYTES = 5 * 1024 * 1024;

// Reading the photos is the point: a merchant who has uploaded pictures should not also have to type what is
// in them. Until now this only ever saw the title, so the pictures contributed nothing to how findable a
// product was.
export async function autofillProduct(input: { titleEn?: string; imageUrls?: string[] }): Promise<{ error: string } | { data: AutofillResult }> {
  const { tenant } = await requireMerchant();
  const title = String(input?.titleEn ?? '').trim().slice(0, 200);

  // Only this shop's own uploads are fetched. Without the prefix check, the URL list would be an open
  // instruction to the server to fetch anything.
  const ownPrefix = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${tenant.id}/`;
  const photoUrls = (Array.isArray(input?.imageUrls) ? input.imageUrls : [])
    .filter((u): u is string => typeof u === 'string' && u.startsWith(ownPrefix))
    .slice(0, MAX_AUTOFILL_PHOTOS);

  if (!title && !photoUrls.length) return { error: 'Add a photo, or type the English title first.' };

  try {
    const photos = [];
    for (const url of photoUrls) {
      const file = await fetch(url).catch(() => null);
      if (!file?.ok) continue;
      const bytes = Buffer.from(await file.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_AUTOFILL_BYTES) continue;
      photos.push({ inlineData: { mimeType: file.headers.get('content-type') ?? 'image/jpeg', data: bytes.toString('base64') } });
    }

    const res = await generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: 'user',
          parts: [...photos, { text: title ? `Product title: ${JSON.stringify(title)}` : 'No title yet. Read the photos and write one.' }],
        },
      ],
      config: { systemInstruction: AUTOFILL_PROMPT, responseMimeType: 'application/json', temperature: 0.2 },
    });
    // Some models (especially in-house ones) wrap the JSON in prose, code fences or <think> blocks: keep only the object.
    const raw = (res.text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '');
    const d = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    return {
      data: {
        titleEn: str(d.titleEn) || title,
        titleBn: str(d.titleBn),
        titleBanglish: str(d.titleBanglish),
        brand: str(d.brand),
        category: str(d.category),
        description: str(d.description),
        voiceTags: Array.isArray(d.voiceTags) ? d.voiceTags.map(str).filter(Boolean).slice(0, 20) : [],
        customNotes: str(d.customNotes),
      },
    };
  } catch (err) {
    console.error('[autofill] failed', err);
    // No made-up fallback data: a failed AI call should leave the form for the merchant to fill.
    const status = (err as { status?: number })?.status;
    if (status === 429 || status === 503) return { error: 'The AI is busy right now (usage limit or high demand). Wait a minute and try again.' };
    return { error: 'AI auto-fill failed. Fill the fields yourself or try again.' };
  }
}
