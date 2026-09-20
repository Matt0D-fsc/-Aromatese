// Generates catalogue photos for a demo shop's products and attaches them.
//
//   node scripts/demo-product-photos.mjs demo-shop            # only products with no photo yet
//   node scripts/demo-product-photos.mjs demo-shop --force    # replace what is there
//   node scripts/demo-product-photos.mjs demo-shop --dry-run  # print the prompts, call nothing
//
// For demo and review shops only. A real merchant's catalogue must show the thing they actually sell —
// an invented photo of a saree nobody owns is a lie told to their customer, not a placeholder.
//
// Keys are read from web/.env.local. Set one of:
//   OPENAI_API_KEY   (default, gpt-image-1; override with IMAGE_MODEL)
//   GOOGLE_API_KEY   (an AI Studio key, the AIza... kind; override with IMAGE_MODEL)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// supabase-js and sharp are the web app's dependencies, not this folder's; resolve them from there rather
// than installing a second copy at the repo root.
const require = createRequire(new URL('../web/package.json', import.meta.url));
const { createClient } = require('@supabase/supabase-js');
const sharp = require('sharp');

const ENV_PATH = fileURLToPath(new URL('../web/.env.local', import.meta.url));
const BUCKET = 'product-images';
const SIZE = 1000;

const env = Object.fromEntries(
  readFileSync(ENV_PATH, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);

const [slug, ...flags] = process.argv.slice(2);
const force = flags.includes('--force');
const dryRun = flags.includes('--dry-run');
if (!slug) fail('Usage: node scripts/demo-product-photos.mjs <shop-slug> [--force] [--dry-run]');

function fail(message) {
  console.error(message);
  process.exit(1);
}

// A catalogue brief rather than an art prompt: the point is a clean cut-out on plain ground, the way a real
// product listing looks, not a styled lifestyle shot the card has no room for.
const promptFor = (product) =>
  `Professional e-commerce catalogue photograph of ${product.title_en.toLowerCase()}` +
  `${product.category ? `, ${product.category.toLowerCase()}` : ''}. ` +
  'A single item, centred, filling most of the frame, on a plain soft off-white studio background. ' +
  'Even diffused lighting, gentle natural shadow beneath, sharp focus, true-to-life colour, square crop. ' +
  'No people, no hands, no text, no logos, no watermark, no props, no collage.';

async function generate(prompt) {
  const model = env.IMAGE_MODEL;

  if (env.OPENAI_API_KEY) {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: model || 'gpt-image-1', prompt, size: '1024x1024', n: 1 }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
    const image = body.data?.[0];
    if (image?.b64_json) return Buffer.from(image.b64_json, 'base64');
    if (image?.url) return Buffer.from(await (await fetch(image.url)).arrayBuffer());
    throw new Error('OpenAI returned no image');
  }

  if (env.GOOGLE_API_KEY) {
    const name = model || 'gemini-2.5-flash-image';
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${name}:generateContent?key=${env.GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE'] } }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`Google ${res.status}: ${JSON.stringify(body).slice(0, 300)}\nTry another IMAGE_MODEL; list them at /v1beta/models.`);
    const part = body.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part) throw new Error('Google returned no image');
    return Buffer.from(part.inlineData.data, 'base64');
  }

  fail('No image key. Add OPENAI_API_KEY or GOOGLE_API_KEY to web/.env.local.');
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: tenant } = await db.from('tenants').select('id, name').eq('slug', slug).maybeSingle();
if (!tenant) fail(`No shop with slug "${slug}".`);

const { data: products, error } = await db
  .from('products')
  .select('id, title_en, category, image_urls')
  .eq('tenant_id', tenant.id)
  .eq('is_active', true)
  .order('created_at');
if (error) fail(error.message);

const todo = products.filter((p) => force || !(p.image_urls ?? []).length);
console.log(`${tenant.name}: ${products.length} products, ${todo.length} to do${force ? ' (--force)' : ''}.`);

for (const product of todo) {
  const prompt = promptFor(product);
  if (dryRun) {
    console.log(`\n${product.title_en}\n  ${prompt}`);
    continue;
  }

  process.stdout.write(`${product.title_en} … `);
  try {
    const raw = await generate(prompt);
    // Square and modest: these are shown in a card a few hundred pixels wide, often on a phone on mobile data.
    const png = await sharp(raw).resize(SIZE, SIZE, { fit: 'cover' }).png({ quality: 90, effort: 9 }).toBuffer();

    const path = `${tenant.id}/${product.id}/photo-1.png`;
    const { error: upErr } = await db.storage.from(BUCKET).upload(path, png, { contentType: 'image/png', upsert: true });
    if (upErr) throw upErr;

    // The app validates that every stored URL sits under this shop's own folder for this product.
    const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
    const { error: dbErr } = await db.from('products').update({ image_urls: [url] }).eq('id', product.id);
    if (dbErr) throw dbErr;

    console.log(`ok (${Math.round(png.length / 1024)}KB)`);
  } catch (err) {
    console.log(`FAILED — ${err.message}`);
  }
}
