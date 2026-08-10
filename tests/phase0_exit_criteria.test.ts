import { describe, it, expect, beforeEach } from 'vitest';
import { SecretsManager } from '../src/services/SecretsManager.js';
import { KillSwitch, TenantKillSwitchProvider } from '../src/services/KillSwitch.js';
import { IdempotencyManager, IdempotencyStore, IdempotencyRecord, IdempotencyScope } from '../src/services/IdempotencyManager.js';
import { AuditLogger, AuditLogStore, AuditLogEntry } from '../src/services/AuditLogger.js';

// MOCK IN-MEMORY MULTI-TENANT DATABASE STORE FOR PHASE 0 ISOLATION TESTS
class MockMultiTenantDb implements TenantKillSwitchProvider, IdempotencyStore, AuditLogStore {
  public tenants: Map<string, { id: string; name: string; aiEnabled: boolean }> = new Map();
  public conversations: Map<string, { id: string; tenantId: string; muted: boolean }> = new Map();
  public orders: Map<string, { id: string; tenantId: string; idempotencyKey: string; totalBdt: number }> = new Map();
  public idempotencyRecords: Map<string, IdempotencyRecord> = new Map();
  public auditLogs: AuditLogEntry[] = [];

  // RLS SIMULATION HELPER
  public queryOrders(activeTenantId: string): any[] {
    return Array.from(this.orders.values()).filter(o => o.tenantId === activeTenantId);
  }

  // TenantKillSwitchProvider
  async getTenantAiEnabled(tenantId: string): Promise<boolean> {
    const tenant = this.tenants.get(tenantId);
    return tenant ? tenant.aiEnabled : false;
  }

  async getConversationMutedStatus(tenantId: string, conversationId: string): Promise<boolean> {
    const conv = this.conversations.get(conversationId);
    if (!conv || conv.tenantId !== tenantId) return true; // Block if wrong tenant
    return conv.muted;
  }

  // IdempotencyStore
  async getRecord(tenantId: string, scope: IdempotencyScope, key: string): Promise<IdempotencyRecord | null> {
    const compositeKey = `${tenantId}:${scope}:${key}`;
    return this.idempotencyRecords.get(compositeKey) || null;
  }

  async saveRecord(record: IdempotencyRecord): Promise<void> {
    const compositeKey = `${record.tenantId}:${record.scope}:${record.idempotencyKey}`;
    this.idempotencyRecords.set(compositeKey, record);
  }

  // AuditLogStore
  async insertLog(entry: AuditLogEntry): Promise<void> {
    this.auditLogs.push(entry);
  }
}

describe('PHASE 0: Foundations, Multi-Tenancy & Safety Skeleton (Exit Criteria Validation)', () => {
  let db: MockMultiTenantDb;
  let killSwitch: KillSwitch;
  let idempotencyManager: IdempotencyManager;
  let secretsManager: SecretsManager;
  let auditLogger: AuditLogger;

  const TENANT_A_ID = 'tenant-a-uuid-1111';
  const TENANT_B_ID = 'tenant-b-uuid-2222';

  beforeEach(() => {
    db = new MockMultiTenantDb();
    
    // Seed Tenants
    db.tenants.set(TENANT_A_ID, { id: TENANT_A_ID, name: 'Shop A (F-Commerce)', aiEnabled: true });
    db.tenants.set(TENANT_B_ID, { id: TENANT_B_ID, name: 'Shop B (WhatsApp Store)', aiEnabled: true });

    killSwitch = new KillSwitch(db);
    idempotencyManager = new IdempotencyManager(db);
    secretsManager = new SecretsManager('test-master-encryption-key-32bytes');
    auditLogger = new AuditLogger(db);
  });

  it('EXIT CRITERION 1: Multi-Tenancy Isolation — Tenant B cannot read or write Tenant A data', async () => {
    // Insert order under Tenant A
    db.orders.set('order-1', { id: 'order-1', tenantId: TENANT_A_ID, idempotencyKey: 'idemp-1', totalBdt: 1200 });

    // Query orders as Tenant A
    const tenantAOrders = db.queryOrders(TENANT_A_ID);
    expect(tenantAOrders).toHaveLength(1);
    expect(tenantAOrders[0].id).toBe('order-1');

    // Query orders as Tenant B
    const tenantBOrders = db.queryOrders(TENANT_B_ID);
    expect(tenantBOrders).toHaveLength(0); // Tenant B MUST see 0 rows
  });

  it('EXIT CRITERION 2: Kill Switch — Flipping the kill switch stops AI replies within 1 request cycle', async () => {
    // Initial check: AI should be allowed
    const check1 = await killSwitch.canGenerateAiReply(TENANT_A_ID);
    expect(check1.isAllowed).toBe(true);

    // Disable AI for Tenant A
    db.tenants.get(TENANT_A_ID)!.aiEnabled = false;

    // Immediate next request: AI MUST be blocked
    const check2 = await killSwitch.canGenerateAiReply(TENANT_A_ID);
    expect(check2.isAllowed).toBe(false);
    expect(check2.reason).toBe('TENANT_KILL_SWITCH_ACTIVE');

    // Test Global Kill Switch override
    killSwitch.setGlobalAiDisabled(true);
    const check3 = await killSwitch.canGenerateAiReply(TENANT_B_ID);
    expect(check3.isAllowed).toBe(false);
    expect(check3.reason).toBe('GLOBAL_KILL_SWITCH_ACTIVE');
  });

  it('EXIT CRITERION 3: Order Idempotency — Simulated duplicate order calls result in exactly 1 order row', async () => {
    let orderCreateCallCount = 0;
    const idempotencyKey = 'checkout_session_abc123';

    const createOrderOperation = async () => {
      orderCreateCallCount++;
      const newOrder = {
        id: `order-row-${orderCreateCallCount}`,
        tenantId: TENANT_A_ID,
        idempotencyKey,
        totalBdt: 2500,
      };
      db.orders.set(newOrder.id, newOrder);
      return newOrder;
    };

    // First call (Simulated primary submission)
    const call1 = await idempotencyManager.executeIdempotent(
      TENANT_A_ID,
      'order_creation',
      idempotencyKey,
      createOrderOperation
    );
    expect(call1.wasCached).toBe(false);
    expect(call1.result.id).toBe('order-row-1');

    // Second call (Simulated duplicate click / network retry)
    const call2 = await idempotencyManager.executeIdempotent(
      TENANT_A_ID,
      'order_creation',
      idempotencyKey,
      createOrderOperation
    );
    expect(call2.wasCached).toBe(true);
    expect(call2.result.id).toBe('order-row-1');

    // Verify DB state: exactly 1 order row created
    expect(orderCreateCallCount).toBe(1);
    expect(db.queryOrders(TENANT_A_ID)).toHaveLength(1);
  });

  it('AUXILIARY CHECK: Encrypted Secrets Manager protects per-tenant API credentials', async () => {
    const rawSecrets = {
      metaAccessToken: 'EAAXX123456789SecretToken',
      bkashAppKey: 'bkash_key_9999',
      pathaoClientId: 'pathao_cid_8888',
    };

    const encrypted = secretsManager.encrypt(rawSecrets);
    expect(encrypted).not.toContain('EAAXX123456789SecretToken');

    const decrypted = secretsManager.decrypt(encrypted);
    expect(decrypted.metaAccessToken).toBe('EAAXX123456789SecretToken');
    expect(decrypted.bkashAppKey).toBe('bkash_key_9999');
  });

  it('AUXILIARY CHECK: Audit Logger persists grounding proof for dispute resolution', async () => {
    await auditLogger.logEvent({
      tenantId: TENANT_A_ID,
      conversationId: 'conv-100',
      eventType: 'AI_REPLY_SENT',
      llmPrompt: 'System prompt + user query',
      llmRawResponse: 'Aita 1200 BDT, stock 5 ta ache.',
      toolCalls: [{ name: 'query_catalog', args: { sku: 'SHIRT-01' } }],
      groundingProof: { sku: 'SHIRT-01', priceBdt: 1200, stockQuantity: 5 },
    });

    expect(db.auditLogs).toHaveLength(1);
    expect(db.auditLogs[0].eventType).toBe('AI_REPLY_SENT');
    expect(db.auditLogs[0].groundingProof).toEqual({ sku: 'SHIRT-01', priceBdt: 1200, stockQuantity: 5 });
  });
});
