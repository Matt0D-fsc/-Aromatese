-- Migration: 018_launch_hardening.sql
-- Description: Fixes from the pre-launch workflow audit.
--   1. The platform admin's per-shop AI persona moves out of tenants. Shop members can read their own tenants
--      row (tenants_read), so "instructions only the admin can see" were readable through the API by any
--      merchant or staff member. The new table has RLS on, no policies and no grants: service role only.
--   2. Indexes the database advisor flagged on the hottest paths: a conversation's messages (every chat turn,
--      the inbox, the limit checks), a customer's orders and chats, a product's variants.
--   3. Stock that stays true. confirm_order refused nothing: it clamped stock at 0 and confirmed anyway, so the
--      last item could be sold twice. Now it refuses when stock is short, naming the item. And a confirmed order
--      could never be cancelled, so a refused delivery left its stock gone for good; cancel_order puts it back.
--      A line with a size or colour takes stock from that variant only; a line without one, from the product.

-- 1. PRIVATE AI PERSONA
CREATE TABLE IF NOT EXISTS tenant_ai_persona (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  persona JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE tenant_ai_persona ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tenant_ai_persona FROM PUBLIC, anon, authenticated;

INSERT INTO tenant_ai_persona (tenant_id, persona)
SELECT id, ai_persona FROM tenants WHERE ai_persona IS NOT NULL AND ai_persona <> '{}'::jsonb
ON CONFLICT (tenant_id) DO NOTHING;
ALTER TABLE tenants DROP COLUMN IF EXISTS ai_persona;

-- 2. INDEXES
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_conversations_customer ON conversations (customer_id);
CREATE INDEX IF NOT EXISTS idx_variants_product ON variants (product_id);

-- 3. STOCK
CREATE OR REPLACE FUNCTION confirm_order(oid UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  o orders;
  l RECORD;
BEGIN
  UPDATE orders SET status = 'confirmed' WHERE id = oid AND status = 'draft' RETURNING * INTO o;
  IF NOT FOUND THEN RETURN; END IF;

  FOR l IN
    SELECT (e->>'product_id')::uuid AS pid, e->>'variant' AS vname, sum((e->>'quantity')::int) AS qty, max(e->>'title') AS title
    FROM jsonb_array_elements(o.items) e
    GROUP BY 1, 2
  LOOP
    -- The stock condition inside the UPDATE is the lock: two orders confirmed at once cannot both take the last one.
    IF l.vname IS NULL THEN
      UPDATE products SET stock_quantity = stock_quantity - l.qty, updated_at = NOW()
      WHERE id = l.pid AND tenant_id = o.tenant_id AND stock_quantity >= l.qty;
      IF NOT FOUND AND EXISTS (SELECT 1 FROM products WHERE id = l.pid AND tenant_id = o.tenant_id) THEN
        RAISE EXCEPTION 'Not enough stock for %', l.title USING HINT = 'out_of_stock';
      END IF;
    ELSE
      UPDATE variants SET stock_quantity = stock_quantity - l.qty
      WHERE product_id = l.pid AND name = l.vname AND tenant_id = o.tenant_id AND stock_quantity >= l.qty;
      IF NOT FOUND AND EXISTS (SELECT 1 FROM variants WHERE product_id = l.pid AND name = l.vname AND tenant_id = o.tenant_id) THEN
        RAISE EXCEPTION 'Not enough stock for %', l.title USING HINT = 'out_of_stock';
      END IF;
    END IF;
    -- A product or size deleted since the order was taken has no stock to take; the order still confirms.
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION confirm_order(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION confirm_order(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION cancel_order(oid UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  o orders;
  was TEXT;
  l RECORD;
BEGIN
  SELECT * INTO o FROM orders WHERE id = oid FOR UPDATE;
  IF NOT FOUND OR o.status = 'cancelled' THEN RETURN; END IF;
  was := o.status;
  UPDATE orders SET status = 'cancelled' WHERE id = oid;
  IF was <> 'confirmed' THEN RETURN; END IF;

  -- Only a confirmed order took stock, so only a confirmed order gives it back.
  FOR l IN
    SELECT (e->>'product_id')::uuid AS pid, e->>'variant' AS vname, sum((e->>'quantity')::int) AS qty
    FROM jsonb_array_elements(o.items) e
    GROUP BY 1, 2
  LOOP
    IF l.vname IS NULL THEN
      UPDATE products SET stock_quantity = stock_quantity + l.qty, updated_at = NOW() WHERE id = l.pid AND tenant_id = o.tenant_id;
    ELSE
      UPDATE variants SET stock_quantity = stock_quantity + l.qty WHERE product_id = l.pid AND name = l.vname AND tenant_id = o.tenant_id;
    END IF;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION cancel_order(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cancel_order(UUID) TO authenticated;

-- 4. Earlier persona changes were audited with their text, and shop members can read their shop's audit rows.
UPDATE audit_logs SET detail = jsonb_build_object('fields', (SELECT jsonb_agg(k) FROM jsonb_object_keys(detail) k))
WHERE event_type = 'merchant.ai_persona_changed' AND detail IS NOT NULL AND NOT detail ? 'fields';
