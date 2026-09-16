-- Migration: 005_realtime_dashboards.sql
-- Description: Stream chat, order and product changes to the merchant and admin dashboards.
-- Supabase Realtime applies each table's RLS policies, so merchants only receive their own shop's rows
-- and the platform admin receives every shop's.
ALTER PUBLICATION supabase_realtime ADD TABLE messages, conversations, orders, products;
