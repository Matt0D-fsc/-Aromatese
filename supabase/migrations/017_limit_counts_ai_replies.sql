-- Migration: 017_limit_counts_ai_replies.sql
-- Description: tenants.monthly_message_limit now caps the AI's replies only. It counted every message, so a
-- merchant answering customers by hand used up the allowance meant to cap what their AI costs, and a busy
-- team could switch its own AI off. Customer messages and staff replies are free.
-- The column keeps its name; `messages` stays in the view as a plain activity figure, and ai_replies is added
-- at the end, which CREATE OR REPLACE VIEW allows.
CREATE OR REPLACE VIEW tenant_usage_month WITH (security_invoker = true) AS
SELECT t.id AS tenant_id, m.messages, m.tokens, c.conversations, o.orders, o.order_value, m.ai_replies
FROM tenants t
CROSS JOIN LATERAL (
  SELECT count(*)::int AS messages,
         coalesce(sum(prompt_tokens + output_tokens), 0)::bigint AS tokens,
         (count(*) FILTER (WHERE sender_type = 'bot'))::int AS ai_replies
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
