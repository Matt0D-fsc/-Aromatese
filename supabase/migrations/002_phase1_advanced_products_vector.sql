-- Migration: 002_phase1_advanced_products_vector.sql
-- Description: Expand products table with voice_tags, custom_notes, brand, discount_price_bdt, and image_embedding vector(768)

ALTER TABLE products 
  ADD COLUMN IF NOT EXISTS brand VARCHAR(255),
  ADD COLUMN IF NOT EXISTS discount_price_bdt NUMERIC(10, 2) CHECK (discount_price_bdt >= 0),
  ADD COLUMN IF NOT EXISTS voice_tags JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS custom_notes TEXT,
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS image_embedding vector(768);

CREATE INDEX IF NOT EXISTS idx_products_voice_tags ON products USING gin(voice_tags);
