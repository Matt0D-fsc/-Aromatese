-- Migration: 003_auth_tenancy_onboarding.sql
-- Description: Supabase Auth-based tenancy (platform admin + invited merchants), tenant status/onboarding,
-- multi-photo products, and a per-tenant product-images storage bucket.
-- Replaces 001's app.current_tenant_id RLS policies, which Supabase Auth clients cannot set.

-- 1. PROFILES (one per auth user)
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT,
    is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-create a profile when an invited user is created. Admin rights are granted by hand only:
--   UPDATE profiles SET is_platform_admin = TRUE WHERE email = 'you@example.com';
CREATE OR REPLACE FUNCTION handle_new_user() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email) VALUES (NEW.id, NEW.email) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 2. TENANT MEMBERS (which users belong to which merchant). Written only by the server with the service role.
CREATE TABLE IF NOT EXISTS tenant_members (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'staff')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_tenant_members_user ON tenant_members(user_id);

-- 3. TENANT ACCESS + ONBOARDING FIELDS
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited', 'active', 'suspended')),
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(20),
  ADD COLUMN IF NOT EXISTS business_category VARCHAR(100),
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS monthly_message_limit INT NOT NULL DEFAULT 1000 CHECK (monthly_message_limit >= 0),
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

-- 4. PRODUCTS: multiple photos + category
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS image_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS category VARCHAR(100);

-- 5. ACCESS HELPERS (SECURITY DEFINER so policies can read membership without recursive RLS)
CREATE OR REPLACE FUNCTION is_platform_admin() RETURNS BOOLEAN AS $$
  SELECT COALESCE((SELECT is_platform_admin FROM public.profiles WHERE id = auth.uid()), FALSE);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION is_tenant_member(tid UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM public.tenant_members WHERE tenant_id = tid AND user_id = auth.uid());
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Suspended merchants can still sign in and read, but cannot write.
CREATE OR REPLACE FUNCTION can_write_tenant(tid UUID) RETURNS BOOLEAN AS $$
  SELECT is_platform_admin() OR EXISTS (
    SELECT 1 FROM public.tenant_members m JOIN public.tenants t ON t.id = m.tenant_id
    WHERE m.tenant_id = tid AND m.user_id = auth.uid() AND t.status <> 'suspended'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- 6. REPLACE 001 POLICIES WITH AUTH-BASED ONES
DROP POLICY IF EXISTS tenant_isolation_tenants ON tenants;
DROP POLICY IF EXISTS tenant_isolation_secrets ON tenant_secrets;
DROP POLICY IF EXISTS tenant_isolation_products ON products;
DROP POLICY IF EXISTS tenant_isolation_variants ON variants;
DROP POLICY IF EXISTS tenant_isolation_customers ON customers;
DROP POLICY IF EXISTS tenant_isolation_conversations ON conversations;
DROP POLICY IF EXISTS tenant_isolation_messages ON messages;
DROP POLICY IF EXISTS tenant_isolation_orders ON orders;
DROP POLICY IF EXISTS tenant_isolation_idempotency ON idempotency_records;
DROP POLICY IF EXISTS tenant_isolation_audit_logs ON audit_logs;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_self_read ON profiles FOR SELECT USING (id = auth.uid() OR is_platform_admin());
CREATE POLICY profiles_self_update ON profiles FOR UPDATE USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND is_platform_admin = (SELECT p.is_platform_admin FROM profiles p WHERE p.id = auth.uid()));

CREATE POLICY members_read ON tenant_members FOR SELECT USING (user_id = auth.uid() OR is_platform_admin());

-- Tenants: members read their own; merchants edit profile fields via server actions (status/limits are admin-only,
-- enforced by only exposing those fields through service-role admin actions).
CREATE POLICY tenants_read ON tenants FOR SELECT USING (is_tenant_member(id) OR is_platform_admin());
CREATE POLICY tenants_admin_write ON tenants FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

-- Secrets: never readable from the browser; service role only (no policies = denied).

-- Tenant-scoped data tables: members read, non-suspended members + admin write.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['products', 'variants', 'customers', 'conversations', 'messages', 'orders'] LOOP
    EXECUTE format('CREATE POLICY %1$s_read ON %1$s FOR SELECT USING (is_tenant_member(tenant_id) OR is_platform_admin())', t);
    EXECUTE format('CREATE POLICY %1$s_insert ON %1$s FOR INSERT WITH CHECK (can_write_tenant(tenant_id))', t);
    EXECUTE format('CREATE POLICY %1$s_update ON %1$s FOR UPDATE USING (can_write_tenant(tenant_id)) WITH CHECK (can_write_tenant(tenant_id))', t);
    EXECUTE format('CREATE POLICY %1$s_delete ON %1$s FOR DELETE USING (can_write_tenant(tenant_id))', t);
  END LOOP;
END $$;

-- Audit logs + idempotency: read-only for members/admin; written by the agent server (service role).
CREATE POLICY audit_logs_read ON audit_logs FOR SELECT USING (is_tenant_member(tenant_id) OR is_platform_admin());

-- 7. PRODUCT IMAGES BUCKET. Object path convention: <tenant_id>/<product_id>/<file>
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', TRUE)
ON CONFLICT (id) DO NOTHING;

-- Compares folder names as text so objects in other buckets never hit a failing uuid cast.
CREATE OR REPLACE FUNCTION my_tenant_folders(writable BOOLEAN) RETURNS SETOF TEXT AS $$
  SELECT m.tenant_id::text FROM public.tenant_members m JOIN public.tenants t ON t.id = m.tenant_id
  WHERE m.user_id = auth.uid() AND (NOT writable OR t.status <> 'suspended');
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE POLICY product_images_read ON storage.objects FOR SELECT
  USING (bucket_id = 'product-images' AND (storage.foldername(name))[1] IN (SELECT my_tenant_folders(FALSE)));
CREATE POLICY product_images_write ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'product-images' AND (storage.foldername(name))[1] IN (SELECT my_tenant_folders(TRUE)));
CREATE POLICY product_images_update ON storage.objects FOR UPDATE
  USING (bucket_id = 'product-images' AND (storage.foldername(name))[1] IN (SELECT my_tenant_folders(TRUE)));
CREATE POLICY product_images_delete ON storage.objects FOR DELETE
  USING (bucket_id = 'product-images' AND (storage.foldername(name))[1] IN (SELECT my_tenant_folders(TRUE)));
