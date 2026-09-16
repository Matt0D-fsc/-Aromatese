-- Migration: 004_web_chat_agent_orders.sql
-- Description: Website chat channel, per-message AI token usage, agent product search, order confirmation,
-- a per-shop monthly usage view for the admin console, and the security-advisor fixes for 003.

-- 1. WEBSITE CHAT CHANNEL
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_channel_check;
ALTER TABLE customers ADD CONSTRAINT customers_channel_check CHECK (channel IN ('web', 'whatsapp', 'messenger', 'instagram'));
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_channel_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_channel_check CHECK (channel IN ('web', 'whatsapp', 'messenger', 'instagram'));

-- 2. AI USAGE PER MESSAGE + INDEXES FOR MONTHLY COUNTS AND THE INBOX
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS prompt_tokens INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_tokens INT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_messages_tenant_created ON messages(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_created ON orders(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_tenant_last ON conversations(tenant_id, last_message_at DESC);

-- 3. PRODUCT SEARCH FOR THE AGENT: keyword match across titles (EN/BN/Banglish), brand, category, description and voice tags,
-- ranked by how many keywords hit. Empty query lists the shop's in-stock products first.
-- ponytail: substring match, fine for shop-sized catalogs; add pgvector embeddings when catalogs reach thousands of products.
CREATE OR REPLACE FUNCTION search_products(tid UUID, q TEXT, max_price NUMERIC DEFAULT NULL, lim INT DEFAULT 6)
RETURNS TABLE (
  id UUID, sku VARCHAR, title_en VARCHAR, title_bn VARCHAR, brand VARCHAR, category VARCHAR,
  description TEXT, custom_notes TEXT, price_bdt NUMERIC, discount_price_bdt NUMERIC, stock_quantity INT, photo_count INT
)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH words AS (
    SELECT DISTINCT replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') AS w
    FROM regexp_split_to_table(lower(coalesce(q, '')), '[\s,.!?]+') AS w
    WHERE char_length(w) >= 2
  )
  SELECT p.id, p.sku, p.title_en, p.title_bn, p.brand, p.category, left(p.description, 400), left(p.custom_notes, 400),
         p.price_bdt, p.discount_price_bdt, p.stock_quantity, jsonb_array_length(p.image_urls)
  FROM products p
  CROSS JOIN LATERAL (
    SELECT count(*) AS hits FROM words
    WHERE lower(concat_ws(' ', p.title_en, p.title_bn, p.title_banglish, p.brand, p.category, p.description, p.voice_tags::text))
          LIKE '%' || words.w || '%'
  ) m
  WHERE p.tenant_id = tid
    AND p.is_active
    AND (max_price IS NULL OR coalesce(p.discount_price_bdt, p.price_bdt) <= max_price)
    AND (m.hits > 0 OR NOT EXISTS (SELECT 1 FROM words))
  ORDER BY m.hits DESC, (p.stock_quantity > 0) DESC, p.updated_at DESC
  LIMIT least(greatest(coalesce(lim, 6), 1), 20);
$$;
REVOKE EXECUTE ON FUNCTION search_products(UUID, TEXT, NUMERIC, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION search_products(UUID, TEXT, NUMERIC, INT) TO service_role;

-- 4. CONFIRM ORDER: new -> confirmed and stock deducted in one transaction, once. Runs as the merchant, so RLS scopes it to their shop.
CREATE OR REPLACE FUNCTION confirm_order(oid UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE o orders;
BEGIN
  UPDATE orders SET status = 'confirmed' WHERE id = oid AND status = 'draft' RETURNING * INTO o;
  IF NOT FOUND THEN RETURN; END IF;

  UPDATE products p
  SET stock_quantity = greatest(p.stock_quantity - i.qty, 0), updated_at = NOW()
  FROM (
    SELECT (e->>'product_id')::uuid AS pid, sum((e->>'quantity')::int) AS qty
    FROM jsonb_array_elements(o.items) e
    GROUP BY 1
  ) i
  WHERE p.id = i.pid AND p.tenant_id = o.tenant_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION confirm_order(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION confirm_order(UUID) TO authenticated;

-- 5. MONTHLY USAGE PER SHOP (calendar month, UTC). security_invoker: RLS applies, so only the platform admin sees every shop.
CREATE OR REPLACE VIEW tenant_usage_month WITH (security_invoker = true) AS
SELECT t.id AS tenant_id, m.messages, m.tokens, c.conversations, o.orders, o.order_value
FROM tenants t
CROSS JOIN LATERAL (
  SELECT count(*)::int AS messages, coalesce(sum(prompt_tokens + output_tokens), 0)::bigint AS tokens
  FROM messages WHERE tenant_id = t.id AND created_at >= date_trunc('month', NOW())
) m
CROSS JOIN LATERAL (
  SELECT count(*)::int AS conversations FROM conversations WHERE tenant_id = t.id AND last_message_at >= date_trunc('month', NOW())
) c
CROSS JOIN LATERAL (
  SELECT count(*)::int AS orders, coalesce(sum(total_bdt), 0) AS order_value
  FROM orders WHERE tenant_id = t.id AND status <> 'cancelled' AND created_at >= date_trunc('month', NOW())
) o;
REVOKE ALL ON tenant_usage_month FROM PUBLIC, anon;
GRANT SELECT ON tenant_usage_month TO authenticated;

-- 6. SECURITY ADVISOR FIXES FOR 003
-- Trigger functions never need EXECUTE for callers (checked only when the trigger is created).
REVOKE EXECUTE ON FUNCTION handle_new_user() FROM PUBLIC, anon, authenticated;
-- RLS helpers: signed-in users need them (policies run as the caller); signed-out visitors never do.
REVOKE EXECUTE ON FUNCTION is_platform_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION is_tenant_member(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION can_write_tenant(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION my_tenant_folders(BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION is_platform_admin(), is_tenant_member(UUID), can_write_tenant(UUID), my_tenant_folders(BOOLEAN) TO authenticated;
-- 001's session-variable tenancy helper; unused since 003 replaced its policies.
DROP FUNCTION IF EXISTS current_tenant_id();
