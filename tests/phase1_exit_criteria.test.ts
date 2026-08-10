import { describe, it, expect, beforeEach } from 'vitest';
import { CatalogService } from '../src/services/CatalogService.js';
import { CatalogToolHandler } from '../src/tools/CatalogTools.js';
import { ResponseValidator, ToolCallExecutedResult } from '../src/services/ResponseValidator.js';

describe('PHASE 1: Catalog Grounding & Anti-Hallucination Layer (Exit Criteria Validation)', () => {
  let catalogService: CatalogService;
  let toolHandler: CatalogToolHandler;
  let validator: ResponseValidator;
  const TENANT_ID = 'tenant-shop-bd-123';

  beforeEach(async () => {
    catalogService = new CatalogService();
    toolHandler = new CatalogToolHandler(catalogService);
    validator = new ResponseValidator();

    // Populate catalog with test products (Bangla, English, Banglish)
    await catalogService.upsertProducts(TENANT_ID, [
      {
        sku: 'SHIRT-BLUE-M',
        titleEn: 'Formal Blue Cotton Shirt',
        titleBn: 'ফর্মাল নীল সুতি শার্ট',
        titleBanglish: 'formal blue suti shirt',
        priceBdt: 1250,
        stockQuantity: 15,
        isActive: true,
      },
      {
        sku: 'PANJABI-SILK-L',
        titleEn: 'Premium Silk Panjabi Red',
        titleBn: 'প্রিমিয়াম সিল্ক পাঞ্জাবি লাল',
        titleBanglish: 'premium silk panjabi lal',
        priceBdt: 3500,
        stockQuantity: 3,
        isActive: true,
      },
      {
        sku: 'SAREE-JAMDANI-01',
        titleEn: 'Handloom Jamdani Saree',
        titleBn: 'হাতে বোনা জামদানি শাড়ি',
        titleBanglish: 'hate bona jamdani sari',
        priceBdt: 8500,
        stockQuantity: 0, // Out of stock
        isActive: true,
      },
    ]);
  });

  it('EXIT CRITERION 1: Dual-Field Catalog Search — Matches Bangla, English, and Banglish terms correctly', async () => {
    // English search
    const enResults = await catalogService.searchCatalog({ tenantId: TENANT_ID, searchTerm: 'Shirt' });
    expect(enResults).toHaveLength(1);
    expect(enResults[0].sku).toBe('SHIRT-BLUE-M');

    // Bangla script search
    const bnResults = await catalogService.searchCatalog({ tenantId: TENANT_ID, searchTerm: 'পাঞ্জাবি' });
    expect(bnResults).toHaveLength(1);
    expect(bnResults[0].sku).toBe('PANJABI-SILK-L');

    // Banglish search
    const banglishResults = await catalogService.searchCatalog({ tenantId: TENANT_ID, searchTerm: 'jamdani' });
    expect(banglishResults).toHaveLength(1);
    expect(banglishResults[0].sku).toBe('SAREE-JAMDANI-01');
  });

  it('EXIT CRITERION 2: Catalog Tool Execution — Grounding tools return exact live DB prices & stock', async () => {
    const stockExec = await toolHandler.executeTool(TENANT_ID, 'check_stock', { productIdOrSku: 'SHIRT-BLUE-M' });
    expect(stockExec.toolName).toBe('check_stock');
    const result = stockExec.result as any;
    expect(result.found).toBe(true);
    expect(result.priceBdt).toBe(1250);
    expect(result.stockQuantity).toBe(15);
  });

  it('EXIT CRITERION 3: Stock Update SLA — Manual stock change reflects immediately (<60s)', async () => {
    // Check initial stock
    const initial = await catalogService.checkStock(TENANT_ID, 'PANJABI-SILK-L');
    expect(initial.stockQuantity).toBe(3);

    // Synchronize manual stock change (e.g. 3 -> 0)
    const startTime = Date.now();
    await catalogService.upsertProducts(TENANT_ID, [
      {
        sku: 'PANJABI-SILK-L',
        titleEn: 'Premium Silk Panjabi Red',
        priceBdt: 3500,
        stockQuantity: 0,
      },
    ]);

    const updated = await catalogService.checkStock(TENANT_ID, 'PANJABI-SILK-L');
    const syncDurationMs = Date.now() - startTime;

    expect(updated.stockQuantity).toBe(0);
    expect(syncDurationMs).toBeLessThan(60000); // Must be under 60 seconds
  });

  it('EXIT CRITERION 4 (ADVERSARIAL 100-CASE SUITE): Response Validator catches 100% of injected price/stock hallucinations', async () => {
    // Execute a real tool call to get grounded values: Price 1250 BDT, Stock 15 pcs
    const toolExec = await toolHandler.executeTool(TENANT_ID, 'check_stock', { productIdOrSku: 'SHIRT-BLUE-M' });
    const validToolExecutions: ToolCallExecutedResult[] = [toolExec];

    let caughtCount = 0;

    // Generate 100 adversarial cases (hallucinated prices, fake discounts, fake stock counts, no tool calls)
    const adversarialTestCases: { text: string; tools: ToolCallExecutedResult[]; expectedValid: boolean }[] = [];

    // Case 1: Valid reply
    adversarialTestCases.push({
      text: 'Aita 1250 BDT, stock 15 ta ache.',
      tools: validToolExecutions,
      expectedValid: true,
    });

    // Case 2-51: Injected Hallucinated Prices (e.g., 1310 BDT, 1320 BDT... none equal 1250)
    for (let i = 1; i <= 50; i++) {
      const fakePrice = 1300 + i * 10; // None of these equal 1250
      adversarialTestCases.push({
        text: `Discount price ${fakePrice} BDT sir!`,
        tools: validToolExecutions,
        expectedValid: false,
      });
    }

    // Case 52-81: Injected Hallucinated Stock Counts (e.g., 20 pcs, 50 pcs, 100 pcs)
    for (let i = 1; i <= 30; i++) {
      const fakeStock = 20 + i; // None of these equal 15
      adversarialTestCases.push({
        text: `Haa ache, 1250 BDT e ${fakeStock} pcs baki ache.`,
        tools: validToolExecutions,
        expectedValid: false,
      });
    }

    // Case 82-100: Quotes numbers with ZERO tool calls executed
    for (let i = 1; i <= 19; i++) {
      const fakePrice = 500 + i * 20;
      adversarialTestCases.push({
        text: `This item costs ${fakePrice} BDT.`,
        tools: [], // No tool calls made
        expectedValid: false,
      });
    }

    expect(adversarialTestCases).toHaveLength(100);

    for (const testCase of adversarialTestCases) {
      const result = validator.validateReply(testCase.text, testCase.tools);
      if (result.isValid === testCase.expectedValid) {
        if (!testCase.expectedValid) caughtCount++;
      }
    }

    // Must catch 100% (all 99 invalid cases in the 100-case suite)
    expect(caughtCount).toBe(99);
  });
});
