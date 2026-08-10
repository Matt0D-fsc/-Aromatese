import { ICatalogService, ProductItem, CatalogSearchQuery } from '../interfaces/ICatalogService.js';

export class CatalogService implements ICatalogService {
  private productsDb: Map<string, ProductItem> = new Map();

  /**
   * Search catalog products by text (Bangla, English, Banglish, voice_tags) with dual-field matching.
   */
  public async searchCatalog(query: CatalogSearchQuery): Promise<ProductItem[]> {
    const { tenantId, searchTerm, maxPrice, inStockOnly = false, limit = 20 } = query;
    const term = searchTerm ? searchTerm.toLowerCase().trim() : '';

    const results: ProductItem[] = [];

    for (const product of this.productsDb.values()) {
      if (product.tenantId !== tenantId || !product.isActive) continue;

      if (inStockOnly && product.stockQuantity <= 0) continue;
      const effectivePrice = product.discountPriceBdt || product.priceBdt;
      if (maxPrice !== undefined && effectivePrice > maxPrice) continue;

      if (term) {
        const matchesEn = product.titleEn.toLowerCase().includes(term);
        const matchesBn = product.titleBn ? product.titleBn.toLowerCase().includes(term) : false;
        const matchesBanglish = product.titleBanglish ? product.titleBanglish.toLowerCase().includes(term) : false;
        const matchesSku = product.sku.toLowerCase().includes(term);
        const matchesBrand = product.brand ? product.brand.toLowerCase().includes(term) : false;
        const matchesTags = product.voiceTags
          ? product.voiceTags.some(t => t.toLowerCase().includes(term) || term.includes(t.toLowerCase()))
          : false;

        if (!matchesEn && !matchesBn && !matchesBanglish && !matchesSku && !matchesBrand && !matchesTags) {
          continue;
        }
      }

      results.push(product);
      if (results.length >= limit) break;
    }

    return results;
  }

  /**
   * Retrieve real-time stock and price for a specific product or SKU.
   */
  public async checkStock(
    tenantId: string,
    productIdOrSku: string
  ): Promise<{
    found: boolean;
    product?: ProductItem;
    stockQuantity: number;
    priceBdt: number;
  }> {
    const key = productIdOrSku.trim();

    for (const product of this.productsDb.values()) {
      if (product.tenantId !== tenantId) continue;

      if (product.id === key || product.sku.toLowerCase() === key.toLowerCase()) {
        return {
          found: true,
          product,
          stockQuantity: product.stockQuantity,
          priceBdt: product.discountPriceBdt || product.priceBdt,
        };
      }
    }

    return {
      found: false,
      stockQuantity: 0,
      priceBdt: 0,
    };
  }

  /**
   * Search catalog using image embeddings (ANN vector search via cosine similarity).
   */
  public async searchByVector(tenantId: string, imageEmbedding: number[], limit: number = 5): Promise<ProductItem[]> {
    const scoredProducts: { product: ProductItem; score: number }[] = [];

    for (const product of this.productsDb.values()) {
      if (product.tenantId !== tenantId || !product.isActive) continue;

      const vec = product.imageEmbedding || product.embedding;
      if (!vec) continue;

      const score = this.cosineSimilarity(imageEmbedding, vec);
      scoredProducts.push({ product, score });
    }

    scoredProducts.sort((a, b) => b.score - a.score);
    return scoredProducts.slice(0, limit).map(p => p.product);
  }

  /**
   * Bulk import or update products (Supports incremental stock & vector sync).
   */
  public async upsertProducts(
    tenantId: string,
    products: Partial<ProductItem>[]
  ): Promise<{ success: boolean; count: number }> {
    let count = 0;

    for (const item of products) {
      if (!item.sku || !item.titleEn || item.priceBdt === undefined) continue;

      let existingProduct: ProductItem | undefined;
      for (const prod of this.productsDb.values()) {
        if (prod.tenantId === tenantId && prod.sku === item.sku) {
          existingProduct = prod;
          break;
        }
      }

      const id = item.id || (existingProduct ? existingProduct.id : `prod-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
      const compositeKey = `${tenantId}:${id}`;

      // Generate pseudo text embedding vector if missing
      const textForVector = `${item.titleEn} ${item.titleBn || ''} ${item.titleBanglish || ''} ${(item.voiceTags || []).join(' ')} ${item.customNotes || ''}`;
      const defaultVector = this.generatePseudoVector(textForVector);

      const fullProduct: ProductItem = {
        id,
        tenantId,
        sku: item.sku,
        titleEn: item.titleEn,
        titleBn: item.titleBn ?? existingProduct?.titleBn,
        titleBanglish: item.titleBanglish ?? existingProduct?.titleBanglish,
        description: item.description ?? existingProduct?.description,
        brand: item.brand ?? existingProduct?.brand,
        priceBdt: item.priceBdt,
        discountPriceBdt: item.discountPriceBdt ?? existingProduct?.discountPriceBdt,
        stockQuantity: item.stockQuantity ?? 0,
        isActive: item.isActive ?? existingProduct?.isActive ?? true,
        imageUrl: item.imageUrl ?? existingProduct?.imageUrl,
        imageUrls: item.imageUrls ?? existingProduct?.imageUrls ?? (item.imageUrl ? [item.imageUrl] : []),
        voiceTags: item.voiceTags ?? existingProduct?.voiceTags ?? [],
        customNotes: item.customNotes ?? existingProduct?.customNotes,
        embedding: item.embedding ?? existingProduct?.embedding ?? defaultVector,
        imageEmbedding: item.imageEmbedding ?? existingProduct?.imageEmbedding ?? defaultVector,
      };

      this.productsDb.set(compositeKey, fullProduct);
      count++;
    }

    return { success: true, count };
  }

  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private generatePseudoVector(text: string): number[] {
    const vec = new Array(768).fill(0);
    const words = text.toLowerCase().split(/\W+/);
    for (let i = 0; i < words.length; i++) {
      const hash = this.simpleHash(words[i]);
      vec[hash % 768] += 1.0;
    }
    return vec;
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }
}
