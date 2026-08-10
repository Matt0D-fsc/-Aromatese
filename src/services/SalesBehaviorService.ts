export interface BrandVoiceConfig {
  tone: 'polite' | 'sales_aggressive' | 'formal';
  allowDiscounts: boolean;
  maxConsecutiveAiMessages: number;
}

export class SalesBehaviorService {
  private consecutiveAiMessages: Map<string, number> = new Map(); // Key: `${tenantId}:${conversationId}` -> count

  public getTenantBrandVoice(tenantId: string): BrandVoiceConfig {
    return {
      tone: 'polite',
      allowDiscounts: false, // Default: SERVER-SIDE HARD BOUND - Discounts disabled unless admin toggles
      maxConsecutiveAiMessages: 3,
    };
  }

  /**
   * Check rate limit: prevents runaway AI reply loops if customer is silent.
   */
  public canSendAiMessage(tenantId: string, conversationId: string): { allowed: boolean; reason?: string } {
    const key = `${tenantId}:${conversationId}`;
    const count = this.consecutiveAiMessages.get(key) || 0;

    const config = this.getTenantBrandVoice(tenantId);

    if (count >= config.maxConsecutiveAiMessages) {
      return {
        allowed: false,
        reason: `MAX_CONSECUTIVE_AI_MESSAGES_EXCEEDED: Capped at ${config.maxConsecutiveAiMessages} consecutive messages.`,
      };
    }

    return { allowed: true };
  }

  public recordAiMessageSent(tenantId: string, conversationId: string): void {
    const key = `${tenantId}:${conversationId}`;
    const count = this.consecutiveAiMessages.get(key) || 0;
    this.consecutiveAiMessages.set(key, count + 1);
  }

  public recordCustomerMessageReceived(tenantId: string, conversationId: string): void {
    const key = `${tenantId}:${conversationId}`;
    this.consecutiveAiMessages.set(key, 0); // Reset count on customer reply
  }
}
