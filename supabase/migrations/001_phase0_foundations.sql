-- Migration: 001_phase0_foundations.sql
-- Description: Phase 0 Foundations, Multi-Tenancy & Safety Skeleton Schema with RLS Enabled

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- 1. TENANTS TABLE
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    ai_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. TENANT SECRETS TABLE (ENCRYPTED / RESTRICTED)
CREATE TABLE IF NOT EXISTS tenant_secrets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    encrypted_secrets JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_tenant_secrets_tenant UNIQUE(tenant_id)
);

-- 3. PRODUCTS TABLE
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    sku VARCHAR(100) NOT NULL,
    title_en VARCHAR(255) NOT NULL,
    title_bn VARCHAR(255),
    title_banglish VARCHAR(255),
    description TEXT,
    price_bdt NUMERIC(10, 2) NOT NULL CHECK (price_bdt >= 0),
    stock_quantity INT NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    embedding vector(768),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_sku_per_tenant UNIQUE (tenant_id, sku)
);

-- 4. VARIANTS TABLE
CREATE TABLE IF NOT EXISTS variants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    sku VARCHAR(100) NOT NULL,
    price_bdt NUMERIC(10, 2) NOT NULL CHECK (price_bdt >= 0),
    stock_quantity INT NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_variant_sku_per_tenant UNIQUE (tenant_id, sku)
);

-- 5. CUSTOMERS TABLE
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    phone VARCHAR(20),
    name VARCHAR(255),
    channel VARCHAR(50) NOT NULL CHECK (channel IN ('whatsapp', 'messenger', 'instagram')),
    channel_user_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_customer_channel_user UNIQUE (tenant_id, channel, channel_user_id)
);

-- 6. CONVERSATIONS TABLE
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    channel VARCHAR(50) NOT NULL CHECK (channel IN ('whatsapp', 'messenger', 'instagram')),
    status VARCHAR(50) NOT NULL DEFAULT 'bot' CHECK (status IN ('bot', 'human')),
    ai_muted BOOLEAN NOT NULL DEFAULT FALSE,
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_active_conversation_per_customer UNIQUE (tenant_id, customer_id, channel)
);

-- 7. MESSAGES TABLE
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_type VARCHAR(50) NOT NULL CHECK (sender_type IN ('customer', 'bot', 'agent')),
    content_type VARCHAR(50) NOT NULL CHECK (content_type IN ('text', 'audio', 'image')),
    content_text TEXT,
    media_url TEXT,
    platform_message_id VARCHAR(255),
    grounding_data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. ORDERS TABLE
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    idempotency_key VARCHAR(255) NOT NULL,
    order_number VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'cancelled')),
    total_bdt NUMERIC(10, 2) NOT NULL CHECK (total_bdt >= 0),
    courier_fee_bdt NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (courier_fee_bdt >= 0),
    shipping_address JSONB NOT NULL DEFAULT '{}'::jsonb,
    payment_method VARCHAR(50) NOT NULL CHECK (payment_method IN ('cod', 'bkash', 'nagad')),
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_order_idempotency_key UNIQUE (tenant_id, idempotency_key)
);

-- 9. IDEMPOTENCY RECORDS TABLE
CREATE TABLE IF NOT EXISTS idempotency_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    idempotency_key VARCHAR(255) NOT NULL,
    scope VARCHAR(50) NOT NULL CHECK (scope IN ('message_ingestion', 'order_creation')),
    response_payload JSONB,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_idempotency_scope_key UNIQUE (tenant_id, scope, idempotency_key)
);

-- 10. AUDIT LOGS TABLE
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    event_type VARCHAR(100) NOT NULL,
    llm_prompt TEXT,
    llm_raw_response TEXT,
    tool_calls JSONB DEFAULT '[]'::jsonb,
    grounding_proof JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- INDEXES FOR PERFORMANCE & FAST TENANT FILTERING
CREATE INDEX IF NOT EXISTS idx_products_tenant ON products(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_conversations_tenant ON conversations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(tenant_id, conversation_id);
CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id);

-- ENABLE ROW LEVEL SECURITY (RLS) ON ALL TABLES
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS POLICIES FOR TENANT ISOLATION BASED ON APPLICATION SETTING (app.current_tenant_id)
-- Policy helper function
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS UUID AS $$
BEGIN
  RETURN NULLIF(current_setting('app.current_tenant_id', true), '')::UUID;
END;
$$ LANGUAGE plpgsql STABLE;

-- RLS Policies per table
CREATE POLICY tenant_isolation_tenants ON tenants
  FOR ALL USING (id = current_tenant_id());

CREATE POLICY tenant_isolation_secrets ON tenant_secrets
  FOR ALL USING (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation_products ON products
  FOR ALL USING (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation_variants ON variants
  FOR ALL USING (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation_customers ON customers
  FOR ALL USING (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation_conversations ON conversations
  FOR ALL USING (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation_messages ON messages
  FOR ALL USING (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation_orders ON orders
  FOR ALL USING (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation_idempotency ON idempotency_records
  FOR ALL USING (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation_audit_logs ON audit_logs
  FOR ALL USING (tenant_id = current_tenant_id());
