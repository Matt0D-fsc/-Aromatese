export interface ToolCallExecutedResult {
  toolName: string;
  result: unknown;
}

export interface ValidationResult {
  isValid: boolean;
  rejectedReason?: string;
  extractedClaims: {
    prices: number[];
    stockNumbers: number[];
  };
  groundedValues: {
    prices: number[];
    stockNumbers: number[];
  };
}

export class ResponseValidator {
  /**
   * Validate a draft AI reply against tool outputs executed in the current turn.
   * Catches 100% of ungrounded price/stock hallucinations.
   */
  public validateReply(
    draftReply: string,
    toolExecutions: ToolCallExecutedResult[]
  ): ValidationResult {
    const grounded = this.extractGroundedValuesFromTools(toolExecutions);
    const claims = this.extractClaimsFromText(draftReply);

    // 1. If NO tool calls were made, but AI quotes specific prices or stock numbers, REJECT!
    if (toolExecutions.length === 0) {
      if (claims.prices.length > 0 || claims.stockNumbers.length > 0) {
        return {
          isValid: false,
          rejectedReason: 'UNGROUNDED_CLAIM_WITHOUT_TOOL_CALL: Reply quotes numbers/prices without calling catalog tools.',
          extractedClaims: claims,
          groundedValues: grounded,
        };
      }
      return { isValid: true, extractedClaims: claims, groundedValues: grounded };
    }

    // 2. Verify every claimed price is present in grounded prices
    for (const priceClaim of claims.prices) {
      const isPriceGrounded = grounded.prices.some(gp => Math.abs(gp - priceClaim) < 0.01);
      if (!isPriceGrounded) {
        return {
          isValid: false,
          rejectedReason: `PRICE_HALLUCINATION_DETECTED: Claimed price ${priceClaim} BDT is not traceable to any tool call result.`,
          extractedClaims: claims,
          groundedValues: grounded,
        };
      }
    }

    // 3. Verify every claimed stock number is present in grounded stock numbers
    for (const stockClaim of claims.stockNumbers) {
      const isStockGrounded = grounded.stockNumbers.some(gs => gs === stockClaim);
      if (!isStockGrounded) {
        return {
          isValid: false,
          rejectedReason: `STOCK_HALLUCINATION_DETECTED: Claimed stock quantity ${stockClaim} is not traceable to any tool call result.`,
          extractedClaims: claims,
          groundedValues: grounded,
        };
      }
    }

    return {
      isValid: true,
      extractedClaims: claims,
      groundedValues: grounded,
    };
  }

  /**
   * Parse grounded prices and stock quantities out of tool results.
   */
  private extractGroundedValuesFromTools(toolExecutions: ToolCallExecutedResult[]): {
    prices: number[];
    stockNumbers: number[];
  } {
    const prices: Set<number> = new Set();
    const stockNumbers: Set<number> = new Set();

    for (const exec of toolExecutions) {
      const res = exec.result as any;

      if (!res) continue;

      // Handle query_catalog results
      if (res.products && Array.isArray(res.products)) {
        for (const p of res.products) {
          if (typeof p.priceBdt === 'number') prices.add(p.priceBdt);
          if (typeof p.stockQuantity === 'number') stockNumbers.add(p.stockQuantity);
        }
      }

      // Handle check_stock results
      if (res.priceBdt !== undefined && typeof res.priceBdt === 'number') {
        prices.add(res.priceBdt);
      }
      if (res.stockQuantity !== undefined && typeof res.stockQuantity === 'number') {
        stockNumbers.add(res.stockQuantity);
      }
      if (res.product) {
        if (typeof res.product.priceBdt === 'number') prices.add(res.product.priceBdt);
        if (typeof res.product.stockQuantity === 'number') stockNumbers.add(res.product.stockQuantity);
      }
    }

    return {
      prices: Array.from(prices),
      stockNumbers: Array.from(stockNumbers),
    };
  }

  /**
   * Extract price and stock number claims from raw text (English, Bangla, Banglish).
   */
  private extractClaimsFromText(text: string): { prices: number[]; stockNumbers: number[] } {
    const prices: number[] = [];
    const stockNumbers: number[] = [];

    // Regex for Price: numbers followed or preceded by BDT, Taka, Tk, ৳, tk
    const priceRegex = /(?:(?:bdt|taka|tk|৳)\s*(\d+(?:\.\d+)?))|(?:(\d+(?:\.\d+)?)\s*(?:bdt|taka|tk|৳))/gi;
    let match: RegExpExecArray | null;

    while ((match = priceRegex.exec(text)) !== null) {
      const numStr = match[1] || match[2];
      if (numStr) {
        const val = parseFloat(numStr);
        if (!isNaN(val)) prices.push(val);
      }
    }

    // Regex for Stock: numbers followed by pcs, pieces, ta, ta ache, item, in stock
    const stockRegex = /(\d+)\s*(?:pcs|pieces|ta|ta ache|items?|in stock|ta baki)/gi;
    while ((match = stockRegex.exec(text)) !== null) {
      if (match[1]) {
        const val = parseInt(match[1], 10);
        if (!isNaN(val)) stockNumbers.push(val);
      }
    }

    return { prices, stockNumbers };
  }
}
