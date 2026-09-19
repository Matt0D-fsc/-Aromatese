-- Migration: 014_variant_integrity.sql
-- Description: Three variant problems found in review.
--   1. variants.price_bdt was NOT NULL, so the form's documented "leave the price blank to use the product
--      price" failed on every save. search_products already coalesces a null variant price to the product's,
--      so nullable is what the rest of the system assumed: a blank price now follows the product price
--      instead of freezing a copy of it.
--   2. Saving a product deleted its variants and then inserted the new ones as two separate calls, so a failed
--      insert left the catalog with none. One function, one transaction.
--   3. Confirming an order decremented the parent product only. An order line that names a variant now takes
--      the stock from that variant too.
ALTER TABLE variants ALTER COLUMN price_bdt DROP NOT NULL;

-- Replace one product's variants atomically. SECURITY INVOKER: RLS still decides whose product this is.
CREATE OR REPLACE FUNCTION save_product_variants(pid UUID, tid UUID, rows JSONB) RETURNS VOID
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  DELETE FROM variants WHERE product_id = pid AND tenant_id = tid;

  INSERT INTO variants (tenant_id, product_id, name, sku, price_bdt, stock_quantity)
  SELECT tid, pid, e->>'name', e->>'sku',
         CASE WHEN e->>'price_bdt' IS NULL THEN NULL ELSE (e->>'price_bdt')::NUMERIC END,
         (e->>'stock_quantity')::INT
  FROM jsonb_array_elements(coalesce(rows, '[]'::jsonb)) e;
END $$;
REVOKE EXECUTE ON FUNCTION save_product_variants(UUID, UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION save_product_variants(UUID, UUID, JSONB) TO authenticated;

-- Confirming an order: same transaction as before, now also taking variant stock when a line names one.
-- ponytail: product and variant stock are tracked side by side because merchants type both in by hand; a
-- variant sale reduces each. Collapse to one source if that ever stops matching how they actually count.
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

  UPDATE variants v
  SET stock_quantity = greatest(v.stock_quantity - i.qty, 0)
  FROM (
    SELECT (e->>'product_id')::uuid AS pid, e->>'variant' AS vname, sum((e->>'quantity')::int) AS qty
    FROM jsonb_array_elements(o.items) e
    WHERE e->>'variant' IS NOT NULL
    GROUP BY 1, 2
  ) i
  WHERE v.product_id = i.pid AND v.name = i.vname AND v.tenant_id = o.tenant_id;
END $$;
REVOKE EXECUTE ON FUNCTION confirm_order(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION confirm_order(UUID) TO authenticated;
