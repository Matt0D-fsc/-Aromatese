import { describe, it, expect, beforeEach } from 'vitest';
import dotenv from 'dotenv';
import { CatalogService } from '../src/services/CatalogService.js';
import { CatalogToolHandler } from '../src/tools/CatalogTools.js';
import { GeminiLLMProvider } from '../src/services/GeminiLLMProvider.js';
import { VoiceProcessingService } from '../src/services/VoiceProcessingService.js';
import { ImageMatchService } from '../src/services/ImageMatchService.js';
import { KillSwitch } from '../src/services/KillSwitch.js';
import { ResponseValidator } from '../src/services/ResponseValidator.js';
import { AuditLogger, AuditLogEntry } from '../src/services/AuditLogger.js';
import { AgentOrchestrator } from '../src/orchestrator/AgentOrchestrator.js';

dotenv.config();

class MockAuditStore {
  public logs: AuditLogEntry[] = [];
  async insertLog(entry: AuditLogEntry): Promise<void> {
    this.logs.push(entry);
  }
}

describe('PHASE 3: Multimodal Input (Voice & Image) Exit Criteria Validation', () => {
  let catalogService: CatalogService;
  let toolHandler: CatalogToolHandler;
  let geminiProvider: GeminiLLMProvider;
  let voiceService: VoiceProcessingService;
  let imageService: ImageMatchService;
  let killSwitch: KillSwitch;
  let validator: ResponseValidator;
  let auditLogger: AuditLogger;
  let orchestrator: AgentOrchestrator;

  const TENANT_ID = 'tenant-multimodal-bd-001';

  beforeEach(async () => {
    catalogService = new CatalogService();
    toolHandler = new CatalogToolHandler(catalogService);
    geminiProvider = new GeminiLLMProvider(process.env.GEMINI_API_KEY);
    voiceService = new VoiceProcessingService(geminiProvider, 0.6);
    imageService = new ImageMatchService(geminiProvider, catalogService, 0.5);
    killSwitch = new KillSwitch();
    validator = new ResponseValidator();
    auditLogger = new AuditLogger(new MockAuditStore());

    orchestrator = new AgentOrchestrator(
      geminiProvider,
      killSwitch,
      toolHandler,
      validator,
      auditLogger,
      voiceService,
      imageService
    );

    // Seed catalog with Punjabi and Saree items
    await catalogService.upsertProducts(TENANT_ID, [
      {
        sku: 'PUNJABI-WHITE-L',
        titleEn: 'White Cotton Panjabi Premium',
        titleBn: 'সাদা সুতি পাঞ্জাবি প্রিমিয়াম',
        titleBanglish: 'sada suti panjabi white',
        priceBdt: 2200,
        stockQuantity: 10,
        isActive: true,
        embedding: new Array(768).fill(0.1),
      },
    ]);
  });

  it('EXIT CRITERION 1: Voice Notes Processing — Clear voice note transcribes correctly, noisy audio triggers human fallback', async () => {
    const clearAudioBuffer = Buffer.from('mock_clear_voice_data');
    const clearRes = await voiceService.processVoiceNote(clearAudioBuffer, 'audio/ogg');
    expect(clearRes.confidence).toBeGreaterThanOrEqual(0.6);

    // Test low-confidence / noisy voice note fallback through Orchestrator
    const noisyJob = {
      jobId: 'job_audio_noisy_1',
      tenantId: TENANT_ID,
      channel: 'whatsapp' as const,
      platformMessageId: 'msg_audio_001',
      senderId: '8801722222222',
      messageType: 'audio' as const,
      timestamp: Date.now(),
    };

    // Override voice processing to simulate street background noise
    const noisyVoiceService = new VoiceProcessingService(
      {
        ...geminiProvider,
        processAudio: async () => ({ transcript: '[UNCLEAR_AUDIO] muffled street noise', confidence: 0.3 }),
      },
      0.6
    );

    const noisyOrchestrator = new AgentOrchestrator(
      geminiProvider,
      killSwitch,
      toolHandler,
      validator,
      auditLogger,
      noisyVoiceService,
      imageService
    );

    const result = await noisyOrchestrator.processMessageJob(noisyJob);
    expect(result.escalatedToHuman).toBe(true);
    expect(result.replyText).toContain('spashto shona jacche na');
  });

  it('EXIT CRITERION 2: Product Image Matching — Top-K vector search + Gemini vision verification matches product or offers honest fallback', async () => {
    const imageJob = {
      jobId: 'job_img_001',
      tenantId: TENANT_ID,
      channel: 'whatsapp' as const,
      platformMessageId: 'msg_img_100',
      senderId: '8801733333333',
      messageType: 'image' as const,
      timestamp: Date.now(),
    };

    const reply = await orchestrator.processMessageJob(imageJob);

    expect(reply.isValidated).toBe(true);
    expect(reply.replyText).toBeTruthy();
    // Must quote matched item SKU or price, or present honest fallback
    expect(reply.replyText).toMatch(/2200|PUNJABI|stock/i);
  });
});
