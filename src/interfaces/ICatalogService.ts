/**
 * Interface ICatalogService
 * Abstraction for Catalog Search, Dual-Field (Banglish + Bangla) Grounding, and Vector Search
 */

export interface ProductItem {
  id: string;
  tenantId: string;
  sku: string;
  titleEn: string;
  titleBn?: string;
  titleBanglish?: string;
  description?: string;
  priceBdt: number;
  stockQuantity: number;
  isActive: boolean;
  imageUrl?: string;
  voiceTags?: string[];
  customNotes?: string;
  embedding?: number[];
}

export interface CatalogSearchQuery {
  tenantId: string;
  searchTerm?: string;
  maxPrice?: number;
  inStockOnly?: boolean;
  limit?: number;
}

export interface ICatalogService {
  /**
   * Search catalog products by text (Bangla, English, Banglish) with fuzzy matching.
   */
  searchCatalog(query: CatalogSearchQuery): Promise<ProductItem[]>;

  /**
   * Retrieve real-time stock and price for a specific product or variant.
   */
  checkStock(tenantId: string, productIdOrSku: string): Promise<{
    found: boolean;
    product?: ProductItem;
    stockQuantity: number;
    priceBdt: number;
  }>;

  /**
   * Search catalog using image embeddings (ANN vector search).
   */
  searchByVector(tenantId: string, imageEmbedding: number[], limit?: number): Promise<ProductItem[]>;

  /**
   * Bulk import or update products.
   */
  upsertProducts(tenantId: string, products: Partial<ProductItem>[]): Promise<{ success: boolean; count: number }>;
}
