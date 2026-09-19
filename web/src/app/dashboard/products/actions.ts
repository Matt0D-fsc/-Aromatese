'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireMerchant } from '@/lib/auth';
import { audit } from '@/lib/audit';
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

  // RLS enforces tenant ownership: updating another shop's product id fails the policy check.
  const { error } = await supabase.from('products').upsert({
    id: input.id,
    tenant_id: tenant.id,
    sku: text(input.sku) ?? `SKU-${input.id.slice(0, 8).toUpperCase()}`,
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

  // Variants are replaced wholesale rather than diffed: a handful of sizes per product makes matching rows
  // up more code than simply writing the list the merchant just saw.
  const variants = (Array.isArray(input.variants) ? input.variants : [])
    .map((v) => ({
      name: String(v?.name ?? '').trim().slice(0, 100),
      price: v?.priceBdt === '' || v?.priceBdt == null ? null : Number(v.priceBdt),
      stock: Math.floor(Number(v?.stockQuantity)),
    }))
    .filter((v) => v.name)
    .slice(0, 50);
  if (variants.some((v) => (v.price !== null && (!Number.isFinite(v.price) || v.price < 0)) || !Number.isInteger(v.stock) || v.stock < 0)) {
    return { error: 'Each size or colour needs a whole-number stock, and a price of 0 or more if you set one.' };
  }

  await supabase.from('variants').delete().eq('product_id', input.id).eq('tenant_id', tenant.id);
  if (variants.length) {
    const { error: variantError } = await supabase.from('variants').insert(
      variants.map((v) => ({
        tenant_id: tenant.id,
        product_id: input.id,
        name: v.name,
        sku: `${text(input.sku) ?? input.id.slice(0, 8).toUpperCase()}-${v.name.replace(/\s+/g, '-').toUpperCase().slice(0, 20)}`,
        price_bdt: v.price,
        stock_quantity: v.stock,
      })),
    );
    if (variantError) return { error: variantError.message };
  }

  revalidatePath('/dashboard', 'layout');
  redirect('/dashboard/products');
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
