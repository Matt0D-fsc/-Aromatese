import { describe, it, expect, beforeEach } from 'vitest';
import { KillSwitch, TenantKillSwitchProvider } from '../src/services/KillSwitch.js';
import { AuditLogger, AuditLogStore, AuditLogEntry } from '../src/services/AuditLogger.js';

class MockStateStore implements TenantKillSwitchProvider, AuditLogStore {
  public mutedConversations: Set<string> = new Set();
  public auditLogs: AuditLogEntry[] = [];

  async getTenantAiEnabled(tenantId: string): Promise<boolean> {
    return true;
  }

  async getConversationMutedStatus(tenantId: string, conversationId: string): Promise<boolean> {
    return this.mutedConversations.has(conversationId);
  }

  async insertLog(entry: AuditLogEntry): Promise<void> {
    this.auditLogs.push(entry);
  }
}

describe('PHASE 6: Human-in-the-Loop Admin Dashboard Exit Criteria Validation', () => {
  let store: MockStateStore;
  let killSwitch: KillSwitch;
  let auditLogger: AuditLogger;

  const TENANT_ID = 'tenant-admin-bd-001';
  const CONVERSATION_ID = 'conv-live-200';

  beforeEach(() => {
    store = new MockStateStore();
    killSwitch = new KillSwitch(store);
    auditLogger = new AuditLogger(store);
  });

  it('EXIT CRITERION 1: Staff Manual Takeover — Takeover mutes AI within 1 message cycle', async () => {
    // Before takeover: AI is allowed
    const check1 = await killSwitch.canGenerateAiReply(TENANT_ID, CONVERSATION_ID);
    expect(check1.isAllowed).toBe(true);

    // Staff clicks "Take Over Chat" button in Admin UI (mutes AI on thread)
    store.mutedConversations.add(CONVERSATION_ID);

    // Immediate next request: AI MUST be blocked
    const check2 = await killSwitch.canGenerateAiReply(TENANT_ID, CONVERSATION_ID);
    expect(check2.isAllowed).toBe(false);
    expect(check2.reason).toBe('CONVERSATION_HUMAN_TAKEOVER_MUTED');
  });

  it('EXIT CRITERION 2: Audit View Dispute Resolution — Dispute can be resolved from audit view alone', async () => {
    // Log AI reply event with exact tool output proof
    await auditLogger.logEvent({
      tenantId: TENANT_ID,
      conversationId: CONVERSATION_ID,
      messageId: 'msg-reply-555',
      eventType: 'AI_REPLY_SENT',
      llmPrompt: 'Aita koto?',
      llmRawResponse: 'Blue Shirt Size M price 1450 BDT, stock 8 pcs.',
      toolCalls: [{ name: 'query_catalog', args: { searchTerm: 'shirt' } }],
      groundingProof: { sku: 'SHIRT-BLUE-M', priceBdt: 1450, stockQuantity: 8, timestamp: new Date().toISOString() },
    });

    // Verify dispute resolution from audit log query
    const log = store.auditLogs.find(l => l.conversationId === CONVERSATION_ID);
    expect(log).toBeDefined();
    expect(log?.groundingProof).toEqual(
      expect.objectContaining({
        sku: 'SHIRT-BLUE-M',
        priceBdt: 1450,
        stockQuantity: 8,
      })
    );
  });
});
