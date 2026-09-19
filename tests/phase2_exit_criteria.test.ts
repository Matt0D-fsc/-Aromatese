import { describe, it, expect, beforeEach } from 'vitest';
import dotenv from 'dotenv';
import { CatalogService } from '../src/services/CatalogService.js';
import { CatalogToolHandler } from '../src/tools/CatalogTools.js';
import { GeminiLLMProvider } from '../src/services/GeminiLLMProvider.js';
import { MessageQueue } from '../src/services/MessageQueue.js';
import { MetaWebhookGateway, MetaWebhookPayload } from '../src/gateways/MetaWebhookGateway.ts';
import { KillSwitch } from '../src/services/KillSwitch.js';
import { ResponseValidator } from '../src/services/ResponseValidator.js';
import { AuditLogger, AuditLogEntry } from '../src/services/AuditLogger.js';
import { AgentOrchestrator } from '../src/orchestrator/AgentOrchestrator.js';

dotenv.config();

class MockAuditLogStore {
  public logs: AuditLogEntry[] = [];
  async insertLog(entry: AuditLogEntry): Promise<void> {
    this.logs.push(entry);
  }
}

describe('PHASE 2: Omnichannel Text Ingestion (Bangla / English / Banglish) Exit Criteria Validation', () => {
  let catalogService: CatalogService;
  let toolHandler: CatalogToolHandler;
  let geminiProvider: GeminiLLMProvider;
  let messageQueue: MessageQueue;
  let webhookGateway: MetaWebhookGateway;
  let killSwitch: KillSwitch;
  let validator: ResponseValidator;
  let auditStore: MockAuditLogStore;
  let auditLogger: AuditLogger;
  let orchestrator: AgentOrchestrator;

  const TENANT_ID = 'tenant-bd-fashion-001';
  const APP_SECRET = 'meta-app-secret-12345';

  beforeEach(async () => {
    catalogService = new CatalogService();
    toolHandler = new CatalogToolHandler(catalogService);
    geminiProvider = new GeminiLLMProvider(process.env.GEMINI_API_KEY);
    messageQueue = new MessageQueue();
    webhookGateway = new MetaWebhookGateway();
    killSwitch = new KillSwitch();
    validator = new ResponseValidator();
    auditStore = new MockAuditLogStore();
    auditLogger = new AuditLogger(auditStore);

    orchestrator = new AgentOrchestrator(
      geminiProvider,
      killSwitch,
      toolHandler,
      validator,
      auditLogger
    );

    // Seed catalog with products in English, Bangla, and Banglish
    await catalogService.upsertProducts(TENANT_ID, [
      {
        id: 'prod-shirt-blue-m',
        sku: 'SHIRT-BLUE-M',
        titleEn: 'Blue Cotton Shirt Size M',
        titleBn: 'নীল সুতি শার্ট সাইজ এম',
        titleBanglish: 'blue suti shirt size M aita',
        priceBdt: 1450,
        stockQuantity: 8,
        isActive: true,
      },
      {
        id: 'prod-panjabi-black-l',
        sku: 'PANJABI-BLACK-L',
        titleEn: 'Black Premium Silk Panjabi',
        titleBn: 'কালো প্রিমিয়াম সিল্ক পাঞ্জাবি',
        titleBanglish: 'kalo silk panjabi black',
        priceBdt: 2800,
        stockQuantity: 4,
        isActive: true,
      },
    ]);
  });

  it('EXIT CRITERION 1: HMAC-SHA256 Signature Verification & Sub-50ms Ack Response', async () => {
    const payloadStr = JSON.stringify({ test: 'webhook_payload' });
    const signature = `sha256=${require('crypto').createHmac('sha256', APP_SECRET).update(payloadStr).digest('hex')}`;

    // Test signature verification
    const isValid = webhookGateway.verifySignature(payloadStr, signature, APP_SECRET);
    expect(isValid).toBe(true);

    // Test Sub-50ms queue enqueue SLA
    const startTime = Date.now();
    const enqueueRes = await messageQueue.enqueue({
      jobId: 'job_test_1',
      tenantId: TENANT_ID,
      channel: 'whatsapp',
      platformMessageId: 'msg_wamid_001',
      senderId: '8801700000000',
      messageType: 'text',
      textContent: 'Aita koto?',
      timestamp: Date.now(),
    });
    const enqueueDurationMs = Date.now() - startTime;

    expect(enqueueRes.success).toBe(true);
    expect(enqueueDurationMs).toBeLessThan(50); // Must be under 50ms
  });

  it('EXIT CRITERION 2: Message Deduplication — Webhook retries never produce duplicate customer-visible replies', async () => {
    const jobData = {
      jobId: 'job_test_retry_1',
      tenantId: TENANT_ID,
      channel: 'whatsapp' as const,
      platformMessageId: 'msg_duplicate_id_99',
      senderId: '8801711111111',
      messageType: 'text' as const,
      textContent: 'Price details please',
      timestamp: Date.now(),
    };

    // First arrival
    const res1 = await messageQueue.enqueue(jobData);
    expect(res1.success).toBe(true);

    // Simulated network retry from Meta (Same platformMessageId)
    const res2 = await messageQueue.enqueue(jobData);
    expect(res2.success).toBe(false); // Rejected as duplicate!
  });

  it('EXIT CRITERION 3: Live Banglish Intent Understanding & Catalog Grounding across Meta channels', async () => {
    // Simulated WhatsApp Webhook Payload in Banglish
    const waPayload: MetaWebhookPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'entry_1',
          changes: [
            {
              value: {
                messages: [
                  {
                    from: '8801812345678',
                    id: 'wamid.HBgLMjAyNDExMTExMQ==',
                    timestamp: `${Math.floor(Date.now() / 1000)}`,
                    type: 'text',
                    text: { body: 'Blue shirt aita koto? Stock ache?' },
                  },
                ],
                contacts: [{ profile: { name: 'Rahim' } }],
              },
            },
          ],
        },
      ],
    };

    const jobs = webhookGateway.parseWebhookPayload(TENANT_ID, waPayload);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].channel).toBe('whatsapp');
    expect(jobs[0].textContent).toBe('Blue shirt aita koto? Stock ache?');

    // Execute through Orchestrator using live Gemini API (with retry fallback on 429)
    let reply: any;
    try {
      reply = await orchestrator.processMessageJob(jobs[0]);
    } catch (err: any) {
      if (err.message.includes('429') || err.message.includes('RESOURCE_EXHAUSTED')) {
        console.warn('Live API hit rate limit, waiting 5 seconds for rate limit window to clear...');
        await new Promise(r => setTimeout(r, 5000));
        reply = await orchestrator.processMessageJob(jobs[0]);
      } else {
        throw err;
      }
    }

    expect(reply.isValidated).toBe(true);
    expect(reply.replyText).toBeTruthy();

    // Verify response contains grounded price (1450 BDT) or stock info
    expect(reply.replyText).toMatch(/1450/);

    // Verify Audit Log captured grounding proof
    expect(auditStore.logs).toHaveLength(1);
    expect(auditStore.logs[0].eventType).toBe('AI_REPLY_SENT');
  }, 25000); // replayed in a normal run; the timeout is for GEMINI_RECORD=1, which calls the real API
});
