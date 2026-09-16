// Form shape for a product. Numbers stay strings while editing so inputs can be empty; the server action parses them.
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
});
