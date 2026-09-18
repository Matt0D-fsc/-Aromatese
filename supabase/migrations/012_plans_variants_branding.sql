-- Migration: 012_plans_variants_branding.sql
-- Description: Tier 3 of SCOPE.md.
--   1. Plans and price per shop, plus the taka cost of a million AI tokens, so the platform owner can see what
--      a merchant pays against what they cost. Until now monthly_message_limit was the only commercial lever.
--   2. Variants reach the agent. The variants table has existed since migration 001 with nothing reading it,
--      while size and colour are the first things an apparel customer asks about.
--   3. Nothing new for branding: tenants.logo_url has been there since 003, it simply had no form.

-- 1. PLANS. Four names, a price, and one platform-wide token rate: a plans table would be more machinery than
-- a handful of hand-set plans deserves.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS plan VARCHAR(20) NOT NULL DEFAULT 'trial' CHECK (plan IN ('trial', 'starter', 'business', 'custom')),
  ADD COLUMN IF NOT EXISTS plan_price_bdt NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (plan_price_bdt >= 0);

ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS taka_per_million_tokens NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (taka_per_million_tokens >= 0);

-- 2. VARIANTS IN SEARCH RESULTS. Same signature and same ranking as before; the agent now also receives each
-- product's variants, so it can answer "ei size ta ache?" from the catalog instead of handing off.
CREATE OR REPLACE FUNCTION search_products(tid UUID, q TEXT, max_price NUMERIC DEFAULT NULL, lim INT DEFAULT 6)
RETURNS TABLE (
  id UUID, sku VARCHAR, title_en VARCHAR, title_bn VARCHAR, brand VARCHAR, category VARCHAR,
  description TEXT, custom_notes TEXT, price_bdt NUMERIC, discount_price_bdt NUMERIC, stock_quantity INT,
  photo_count INT, variants JSONB
)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH words AS (
    SELECT DISTINCT replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') AS w
    FROM regexp_split_to_table(lower(coalesce(q, '')), '[\s,.!?]+') AS w
    WHERE char_length(w) >= 2
  )
  SELECT p.id, p.sku, p.title_en, p.title_bn, p.brand, p.category, left(p.description, 400), left(p.custom_notes, 400),
         p.price_bdt, p.discount_price_bdt, p.stock_quantity, jsonb_array_length(p.image_urls),
         coalesce(v.variants, '[]'::jsonb)
  FROM products p
  CROSS JOIN LATERAL (
    SELECT count(*) AS hits FROM words
    WHERE lower(concat_ws(' ', p.title_en, p.title_bn, p.title_banglish, p.brand, p.category, p.description, p.voice_tags::text))
          LIKE '%' || words.w || '%'
  ) m
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object('name', x.name, 'price_bdt', coalesce(x.price_bdt, p.price_bdt), 'stock', x.stock_quantity)
                     ORDER BY x.name) AS variants
    FROM variants x WHERE x.product_id = p.id
  ) v ON TRUE
  WHERE p.tenant_id = tid
    AND p.is_active
    AND (max_price IS NULL OR coalesce(p.discount_price_bdt, p.price_bdt) <= max_price)
    AND (m.hits > 0 OR NOT EXISTS (SELECT 1 FROM words))
  ORDER BY m.hits DESC, (p.stock_quantity > 0) DESC, p.updated_at DESC
  LIMIT least(greatest(coalesce(lim, 6), 1), 20);
$$;
REVOKE EXECUTE ON FUNCTION search_products(UUID, TEXT, NUMERIC, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION search_products(UUID, TEXT, NUMERIC, INT) TO service_role;
