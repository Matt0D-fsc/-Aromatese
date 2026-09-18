// Form shape for a product. Numbers stay strings while editing so inputs can be empty; the server action parses them.

// A size or a colour, with its own price and stock. Blank price means "same as the product".
export type ProductVariant = { name: string; priceBdt: string; stockQuantity: string };

export type ProductInput = {
  id: string;
  sku: string;
  titleEn: string;
  titleBn: string;
  titleBanglish: string;
  brand: string;
  category: string;
  description: string;
  customNotes: string;
  priceBdt: string;
  discountPriceBdt: string;
  stockQuantity: string;
  isActive: boolean;
  voiceTags: string[];
  imageUrls: string[];
  variants: ProductVariant[];
};

export type ProductRow = {
  id: string;
  sku: string;
  title_en: string;
  title_bn: string | null;
  title_banglish: string | null;
  brand: string | null;
  category: string | null;
  description: string | null;
  custom_notes: string | null;
  price_bdt: number;
  discount_price_bdt: number | null;
  stock_quantity: number;
  is_active: boolean;
  voice_tags: string[] | null;
  image_urls: string[] | null;
  variants?: { id: string; name: string; price_bdt: number | null; stock_quantity: number }[] | null;
};

export const emptyProduct = (id: string): ProductInput => ({
  id,
  sku: '',
  titleEn: '',
  titleBn: '',
  titleBanglish: '',
  brand: '',
  category: '',
  description: '',
  customNotes: '',
  priceBdt: '',
  discountPriceBdt: '',
  stockQuantity: '',
  isActive: true,
  voiceTags: [],
  imageUrls: [],
  variants: [],
});

export const toProductInput = (p: ProductRow): ProductInput => ({
  id: p.id,
  sku: p.sku,
  titleEn: p.title_en,
  titleBn: p.title_bn ?? '',
  titleBanglish: p.title_banglish ?? '',
  brand: p.brand ?? '',
  category: p.category ?? '',
  description: p.description ?? '',
  customNotes: p.custom_notes ?? '',
  priceBdt: String(p.price_bdt),
  discountPriceBdt: p.discount_price_bdt == null ? '' : String(p.discount_price_bdt),
  stockQuantity: String(p.stock_quantity),
  isActive: p.is_active,
  voiceTags: p.voice_tags ?? [],
  imageUrls: p.image_urls ?? [],
  variants: (p.variants ?? []).map((v) => ({
    name: v.name,
    priceBdt: v.price_bdt == null ? '' : String(v.price_bdt),
    stockQuantity: String(v.stock_quantity),
  })),
});
