-- Migration: 011_policies_and_analytics.sql
-- Description: Tier 2 of SCOPE.md.
--   1. product_searches — what customers asked for and whether the shop had it. A search that returns nothing
--      is demand the merchant cannot fill, and it was being thrown away.
--   2. tenants.policies — delivery charge, delivery time, returns, payment and hours. The agent is forbidden
--      from guessing these, so without them it deflects the questions customers ask first.
--   3. Three views for the merchant analytics page. All security_invoker, so RLS scopes each merchant to their
--      own shop and the platform admin sees every shop.
-- Days are Asia/Dhaka days: a shop's "today" ends at midnight in Dhaka, not in London.

-- 1. WHAT CUSTOMERS LOOKED FOR
CREATE TABLE IF NOT EXISTS product_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  query TEXT NOT NULL,
  results INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_searches_tenant ON product_searches (tenant_id, created_at DESC);
ALTER TABLE product_searches ENABLE ROW LEVEL SECURITY;
-- Written by the agent through the service role, which bypasses RLS; merchants only ever read.
DROP POLICY IF EXISTS product_searches_read ON product_searches;
CREATE POLICY product_searches_read ON product_searches FOR SELECT
  USING (is_tenant_member(tenant_id) OR is_platform_admin());

-- 2. SHOP POLICIES. One JSONB column, so adding a policy later needs no migration.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS policies JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 3a. DAILY NUMBERS. One row per shop per Dhaka day.
CREATE OR REPLACE VIEW tenant_daily_stats WITH (security_invoker = true) AS
SELECT tenant_id, day, sum(chats)::bigint AS chats, sum(orders)::bigint AS orders, sum(revenue)::numeric AS revenue,
       sum(ai_messages)::bigint AS ai_messages, sum(staff_messages)::bigint AS staff_messages
FROM (
  SELECT tenant_id, (created_at AT TIME ZONE 'Asia/Dhaka')::date AS day,
         0::bigint AS chats, 0::bigint AS orders, 0::numeric AS revenue,
         count(*) FILTER (WHERE sender_type = 'bot') AS ai_messages,
         count(*) FILTER (WHERE sender_type = 'agent') AS staff_messages
  FROM messages GROUP BY 1, 2
  UNION ALL
  SELECT tenant_id, (created_at AT TIME ZONE 'Asia/Dhaka')::date, count(*), 0, 0, 0, 0
  FROM conversations GROUP BY 1, 2
  UNION ALL
  SELECT tenant_id, (created_at AT TIME ZONE 'Asia/Dhaka')::date, 0, count(*), coalesce(sum(total_bdt), 0), 0, 0
  FROM orders WHERE status <> 'cancelled' GROUP BY 1, 2
) s GROUP BY 1, 2;

-- 3b. WHICH PRODUCTS THE AI ACTUALLY PUT IN FRONT OF PEOPLE, from the cards saved on each reply.
CREATE OR REPLACE VIEW tenant_top_products_30d WITH (security_invoker = true) AS
SELECT m.tenant_id, p->>'id' AS product_id, p->>'title' AS title, count(*)::bigint AS times_shown
FROM messages m, LATERAL jsonb_array_elements(coalesce(m.grounding_data->'products', '[]'::jsonb)) p
WHERE m.created_at >= NOW() - INTERVAL '30 days'
GROUP BY 1, 2, 3;

-- 3c. DEMAND THE SHOP COULD NOT FILL.
CREATE OR REPLACE VIEW tenant_unmatched_searches_30d WITH (security_invoker = true) AS
SELECT tenant_id, lower(btrim(query)) AS query, count(*)::bigint AS times, max(created_at) AS last_asked
FROM product_searches
WHERE results = 0 AND created_at >= NOW() - INTERVAL '30 days' AND btrim(query) <> ''
GROUP BY 1, 2;

REVOKE ALL ON tenant_daily_stats, tenant_top_products_30d, tenant_unmatched_searches_30d FROM PUBLIC, anon;
GRANT SELECT ON tenant_daily_stats, tenant_top_products_30d, tenant_unmatched_searches_30d TO authenticated;
