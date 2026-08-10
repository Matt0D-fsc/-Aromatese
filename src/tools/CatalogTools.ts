import { LLMToolDefinition } from '../interfaces/ILLMProvider.js';
import { CatalogService } from '../services/CatalogService.js';

export const QUERY_CATALOG_TOOL_DEF: LLMToolDefinition = {
  name: 'query_catalog',
  description: 'Search the merchant catalog for products by keyword, category, or Banglish/Bangla terms.',
  parameters: {
    type: 'object',
    properties: {
      searchTerm: {
        type: 'string',
        description: 'Product title or keyword in English, Bangla, or Banglish (e.g. "shirt", "শার্ট", "sart", "panjabi")',
      },
      maxPrice: {
        type: 'number',
        description: 'Maximum budget in BDT (Taka)',
      },
      inStockOnly: {
        type: 'boolean',
        description: 'Filter only items currently in stock',
      },
    },
  },
};

export const CHECK_STOCK_TOOL_DEF: LLMToolDefinition = {
  name: 'check_stock',
  description: 'Check exact real-time stock quantity and BDT price for a specific product ID or SKU.',
  parameters: {
    type: 'object',
    properties: {
      productIdOrSku: {
        type: 'string',
        description: 'The exact product ID or SKU code (e.g., "SHIRT-001", "PANJABI-M")',
      },
    },
    required: ['productIdOrSku'],
  },
};

export class CatalogToolHandler {
  private catalogService: CatalogService;

  constructor(catalogService: CatalogService) {
    this.catalogService = catalogService;
  }

  public async executeTool(
    tenantId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ toolName: string; result: unknown }> {
    if (toolName === 'query_catalog') {
      const searchTerm = args.searchTerm as string | undefined;
      const maxPrice = args.maxPrice as number | undefined;
      const inStockOnly = args.inStockOnly as boolean | undefined;

      const products = await this.catalogService.searchCatalog({
        tenantId,
        searchTerm,
        maxPrice,
        inStockOnly,
      });

      return {
        toolName,
        result: {
          matchedCount: products.length,
          products: products.map(p => ({
            id: p.id,
            sku: p.sku,
            titleEn: p.titleEn,
            titleBn: p.titleBn,
            titleBanglish: p.titleBanglish,
            priceBdt: p.priceBdt,
            stockQuantity: p.stockQuantity,
            inStock: p.stockQuantity > 0,
          })),
        },
      };
    }

    if (toolName === 'check_stock') {
      const productIdOrSku = (args.productIdOrSku as string) || '';
      const stockInfo = await this.catalogService.checkStock(tenantId, productIdOrSku);

      return {
        toolName,
        result: stockInfo,
      };
    }

    throw new Error(`Unknown tool: ${toolName}`);
  }
}
