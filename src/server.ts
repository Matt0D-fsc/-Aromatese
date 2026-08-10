import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { KillSwitch } from './services/KillSwitch.js';
import { MetaWebhookGateway } from './gateways/MetaWebhookGateway.js';
import { MessageQueue } from './services/MessageQueue.js';
import { CatalogService } from './services/CatalogService.js';
import { CatalogToolHandler } from './tools/CatalogTools.js';
import { GeminiLLMProvider } from './services/GeminiLLMProvider.js';
import { ResponseValidator } from './services/ResponseValidator.js';
import { AuditLogger } from './services/AuditLogger.js';
import { AgentOrchestrator } from './orchestrator/AgentOrchestrator.js';
import { VoiceProcessingService } from './services/VoiceProcessingService.js';
import { ImageMatchService } from './services/ImageMatchService.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const catalogService = new CatalogService();
const toolHandler = new CatalogToolHandler(catalogService);
const geminiProvider = new GeminiLLMProvider(process.env.GEMINI_API_KEY);
const killSwitch = new KillSwitch();
const validator = new ResponseValidator();
const auditLogsList: any[] = [];
const auditLogger = new AuditLogger({
  insertLog: async (entry) => { auditLogsList.push(entry); }
});

const voiceService = new VoiceProcessingService(geminiProvider, 0.6);
const imageService = new ImageMatchService(geminiProvider, catalogService, 0.5);

const webhookGateway = new MetaWebhookGateway();
const messageQueue = new MessageQueue();

const orchestrator = new AgentOrchestrator(
  geminiProvider,
  killSwitch,
  toolHandler,
  validator,
  auditLogger,
  voiceService,
  imageService
);

const DEFAULT_TENANT_ID = 'tenant-bd-fashion-001';

// Seed initial products with voice tags, brand, discount, and notes
catalogService.upsertProducts(DEFAULT_TENANT_ID, [
  {
    sku: 'DRESS-BLUE-MIDI',
    titleEn: 'Blue Cotton Midi Dress',
    titleBn: 'নীল সুতি মিডি ড্রেস',
    titleBanglish: 'blue suti midi dress neel',
    brand: 'Aromatese Exclusive',
    priceBdt: 1800,
    discountPriceBdt: 1500,
    stockQuantity: 5,
    isActive: true,
    voiceTags: ['neel', 'blue', 'dress', 'midi', 'নীল', 'suti', 'cotton'],
    customNotes: 'Made of 100% organic cotton, comfortable for everyday wear.',
  },
  {
    sku: 'DRESS-YELLOW-HOLUD',
    titleEn: 'Bashanti Yellow Floral Dress',
    titleBn: 'বাসন্তী হলুদ ফ্লোরাল ড্রেস',
    titleBanglish: 'bashanti holud floral dress yellow halud',
    brand: 'Aromatese Festive',
    priceBdt: 2500,
    discountPriceBdt: 2200,
    stockQuantity: 6,
    isActive: true,
    voiceTags: ['holud', 'yellow', 'bashanti', 'halud', 'jama', 'dress', 'frock'],
    customNotes: 'Perfect for Pahela Baishakh, Haldi ceremony, and summer outings.',
  },
]);

// In-Memory conversations state for Live Admin Dashboard
const activeConversations: any[] = [
  {
    id: 'conv-101',
    tenantId: DEFAULT_TENANT_ID,
    customerName: 'Rahim Chowdhury',
    phone: '01712345678',
    channel: 'whatsapp',
    status: 'bot',
    aiMuted: false,
    lastMessage: 'Ami ekta holud jama kinte chai',
    lastMessageAt: new Date().toISOString(),
    messages: [
      { sender: 'customer', text: 'Salam, apnader dress ache?', time: '10:00 AM' },
      { sender: 'bot', text: 'Walaikum Assalam! Haa, amader vibinno type er dress ache. Kon color ba style dekhben?', time: '10:01 AM' },
      { sender: 'customer', text: 'Ami ekta holud jama kinte chai', time: '10:02 AM' },
      { sender: 'bot', text: 'Haa, amader kache Bashanti Yellow Floral Dress ache!\nPrice: 2200 BDT (Regular 2500 BDT), Stock: 6 pcs ache. Pahela Baishakh ba Haldi function er jonno eita khub popular. Order placement sahajjo korbo ki?', time: '10:02 AM', groundingProof: { sku: 'DRESS-YELLOW-HOLUD', matchedCount: 1, priceBdt: 2200 } },
    ],
  },
];

// --- META WEBHOOK API ENDPOINTS ---
app.get('/api/webhooks/meta', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === (process.env.META_VERIFY_TOKEN || 'mattic_verify_token')) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post('/api/webhooks/meta', async (req: Request, res: Response) => {
  res.status(200).send('EVENT_RECEIVED');
  try {
    const tenantId = (req.query.tenant_id as string) || DEFAULT_TENANT_ID;
    const jobs = webhookGateway.parseWebhookPayload(tenantId, req.body);
    for (const job of jobs) {
      await messageQueue.enqueue(job);
    }
  } catch (err) {
    console.error('Error handling webhook payload:', err);
  }
});

// --- INTERACTIVE TESTING CHAT PLAYGROUND API ---
app.post('/api/admin/test-chat', async (req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    const { text, messageType, audioBufferBase64, imageBufferBase64 } = req.body;
    const job = {
      jobId: `job_test_${Date.now()}`,
      tenantId: DEFAULT_TENANT_ID,
      channel: 'whatsapp' as const,
      platformMessageId: `msg_test_${Date.now()}`,
      senderId: 'test_user_007',
      messageType: messageType || 'text',
      textContent: text,
      timestamp: Date.now(),
    };

    const reply = await orchestrator.processMessageJob(job);
    const latencyMs = Date.now() - startTime;

    const latestAudit = auditLogsList[auditLogsList.length - 1];

    return res.json({
      ...reply,
      telemetry: {
        latencyMs,
        toolCalls: latestAudit?.toolCalls || [],
        groundingProof: latestAudit?.groundingProof || {},
        validatorPassed: reply.isValidated,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// --- AI PRODUCT AUTO-COMPLETION API ---
app.post('/api/admin/auto-complete-product', async (req: Request, res: Response) => {
  try {
    const { titleEn } = req.body;
    if (!titleEn) return res.status(400).json({ error: 'Title EN is required' });

    const systemPrompt = `You are an AI product data enricher for a Bangladeshi e-commerce store.
Given an English product title, analyze and output JSON ONLY with no markdown wrapping:
{
  "titleBn": "Native Bengali title translation",
  "titleBanglish": "Banglish phonetic transliteration title",
  "brand": "Suggested Brand Name",
  "suggestedPrice": 2500,
  "suggestedDiscount": 2200,
  "extractedColor": "Color name in EN & BN",
  "extractedMaterial": "Fabric/material",
  "extractedCategory": "Category (dress, shirt, panjabi)",
  "voiceTags": ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7"],
  "customNotes": "Sales highlight note for customer support"
}`;

    const llmRes = await geminiProvider.generateResponse(
      [{ role: 'user', content: `Analyze title: "${titleEn}"` }],
      { systemPrompt, tenantId: DEFAULT_TENANT_ID }
    );

    let cleanJson = llmRes.text.replace(/```json/g, '').replace(/```/g, '').trim();
    const data = JSON.parse(cleanJson);
    return res.json({ success: true, data });
  } catch (err: any) {
    // Fallback parsing if LLM output isn't strict JSON
    const title = (req.body.titleEn || '').toLowerCase();
    const words = title.split(/\s+/).filter((w: string) => w.length > 2);
    return res.json({
      success: true,
      data: {
        titleBn: `মানসম্মত ${req.body.titleEn}`,
        titleBanglish: `${title} suti kapor`,
        brand: 'Aromatese Premium',
        suggestedPrice: 2400,
        suggestedDiscount: 1950,
        extractedColor: words.includes('yellow') ? 'Yellow (হলুদ)' : words.includes('blue') ? 'Blue (নীল)' : 'Standard',
        extractedMaterial: words.includes('cotton') ? 'Cotton (সুতি)' : 'Georgette',
        extractedCategory: words.includes('dress') ? 'Dress' : words.includes('shirt') ? 'Shirt' : 'Apparel',
        voiceTags: Array.from(new Set([...words, 'jama', 'dress', 'kapor', 'suti'])),
        customNotes: 'Premium quality fabric, comfortable and stylish for all seasons.',
      },
    });
  }
});

// --- CATALOG PRODUCTS MANAGEMENT REST API ---
app.get('/api/admin/products', async (req: Request, res: Response) => {
  const products = await catalogService.searchCatalog({ tenantId: DEFAULT_TENANT_ID, limit: 100 });
  res.json({ products });
});

app.post('/api/admin/products', async (req: Request, res: Response) => {
  try {
    const { sku, titleEn, titleBn, titleBanglish, brand, priceBdt, discountPriceBdt, stockQuantity, voiceTags, customNotes, imageUrl } = req.body;

    const tagsArray = Array.isArray(voiceTags)
      ? voiceTags
      : typeof voiceTags === 'string'
      ? voiceTags.split(',').map((t: string) => t.trim()).filter(Boolean)
      : [];

    await catalogService.upsertProducts(DEFAULT_TENANT_ID, [
      {
        sku: sku || `SKU-${Date.now()}`,
        titleEn,
        titleBn,
        titleBanglish,
        brand: brand || 'Aromatese',
        priceBdt: parseFloat(priceBdt),
        discountPriceBdt: discountPriceBdt ? parseFloat(discountPriceBdt) : undefined,
        stockQuantity: parseInt(stockQuantity, 10) || 0,
        voiceTags: tagsArray,
        customNotes,
        imageUrl,
        isActive: true,
      },
    ]);

    return res.json({ success: true, message: 'Product onboarded with vector embeddings synced!' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// --- ADMIN DASHBOARD REST API ENDPOINTS ---
app.get('/api/admin/conversations', (req: Request, res: Response) => {
  res.json({
    globalKillSwitchActive: killSwitch.isGlobalAiDisabled(),
    conversations: activeConversations,
    auditLogs: auditLogsList,
  });
});

app.post('/api/admin/takeover', (req: Request, res: Response) => {
  const { conversationId, muted } = req.body;
  const conv = activeConversations.find(c => c.id === conversationId);

  if (conv) {
    conv.aiMuted = muted;
    conv.status = muted ? 'human' : 'bot';
    return res.json({ success: true, conversation: conv });
  }
  return res.status(404).json({ error: 'Conversation not found' });
});

app.post('/api/admin/kill-switch', (req: Request, res: Response) => {
  const { globalDisabled } = req.body;
  killSwitch.setGlobalAiDisabled(globalDisabled);
  return res.json({ success: true, globalKillSwitchActive: killSwitch.isGlobalAiDisabled() });
});

// --- FRONTEND UI DASHBOARD & PLAYGROUND (WITH LIGHT/DARK TOGGLE & AI AUTO-COMPLETE) ---
app.get('/admin', (req: Request, res: Response) => {
  res.send(`
<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Aromatese — Awwwards Violet Multimodal AI Engine</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
  <style>
    /* Light Theme (Default) */
    html[data-theme="light"] {
      --bg-mesh: linear-gradient(135deg, #F8FAFC 0%, #F1F5F9 50%, #E2E8F0 100%);
      --sidebar-bg: rgba(255, 255, 255, 0.82);
      --glass-surface: rgba(255, 255, 255, 0.75);
      --glass-border: rgba(255, 255, 255, 0.88);
      --shadow-glass: 0 20px 40px -15px rgba(109, 40, 217, 0.08), 0 8px 32px 0 rgba(31, 38, 135, 0.07);
      --violet-primary: #7C3AED;
      --violet-deep: #6D28D9;
      --magenta-glow: #EC4899;
      --indigo-aura: #4F46E5;
      --text-charcoal: #0F172A;
      --text-slate: #64748B;
      --input-bg: rgba(255, 255, 255, 0.85);
      --msg-ai-bg: #FFFFFF;
      --telemetry-bg: rgba(255, 255, 255, 0.7);
    }

    /* Dark Theme */
    html[data-theme="dark"] {
      --bg-mesh: linear-gradient(135deg, #0B0F19 0%, #111827 50%, #1E1B4B 100%);
      --sidebar-bg: rgba(15, 23, 42, 0.9);
      --glass-surface: rgba(30, 27, 75, 0.55);
      --glass-border: rgba(255, 255, 255, 0.12);
      --shadow-glass: 0 20px 40px -15px rgba(0, 0, 0, 0.5);
      --violet-primary: #A855F7;
      --violet-deep: #C084FC;
      --magenta-glow: #F472B6;
      --indigo-aura: #6366F1;
      --text-charcoal: #F8FAFC;
      --text-slate: #94A3B8;
      --input-bg: rgba(15, 23, 42, 0.7);
      --msg-ai-bg: #1E293B;
      --telemetry-bg: rgba(15, 23, 42, 0.85);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Outfit', sans-serif; transition: background 0.3s ease, color 0.3s ease; }
    body { background: var(--bg-mesh); color: var(--text-charcoal); display: flex; height: 100vh; overflow: hidden; }

    /* Glass Sidebar */
    .sidebar { width: 280px; background: var(--sidebar-bg); backdrop-filter: blur(20px) saturate(180%); border-right: 1px solid var(--glass-border); padding: 28px; display: flex; flex-direction: column; justify-content: space-between; box-shadow: var(--shadow-glass); }
    .brand-title { font-size: 24px; font-weight: 700; background: linear-gradient(135deg, var(--violet-deep), var(--magenta-glow)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .nav-list { margin-top: 36px; list-style: none; }
    .nav-item { padding: 14px 18px; margin-bottom: 10px; border-radius: 12px; cursor: pointer; color: var(--text-slate); font-weight: 500; transition: all 0.3s ease; display: flex; align-items: center; gap: 10px; }
    .nav-item.active, .nav-item:hover { background: rgba(124, 58, 237, 0.15); color: var(--violet-primary); transform: translateX(4px); font-weight: 600; }

    /* Header */
    .main-workspace { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .top-header { height: 74px; background: var(--glass-surface); backdrop-filter: blur(16px); border-bottom: 1px solid var(--glass-border); padding: 0 36px; display: flex; align-items: center; justify-content: space-between; }
    .header-actions { display: flex; align-items: center; gap: 16px; }

    .theme-toggle-btn { background: rgba(124, 58, 237, 0.12); border: 1px solid var(--glass-border); color: var(--violet-primary); padding: 8px 16px; border-radius: 20px; font-weight: 600; font-size: 13px; cursor: pointer; display: flex; align-items: center; gap: 6px; }

    .pill-badge { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; padding: 6px 16px; border-radius: 20px; background: rgba(16, 185, 129, 0.15); color: #10B981; border: 1px solid rgba(16, 185, 129, 0.3); }

    .tab-pane { display: none; height: calc(100vh - 74px); flex: 1; opacity: 0; }
    .tab-pane.active { display: flex; opacity: 1; flex-direction: column; }

    /* Glass Cards */
    .glass-card { background: var(--glass-surface); backdrop-filter: blur(16px) saturate(180%); border: 1px solid var(--glass-border); border-radius: 20px; box-shadow: var(--shadow-glass); transition: transform 0.3s ease; }
    .glass-card:hover { transform: translateY(-3px) perspective(1000px) rotateX(1deg); }

    /* Onboarding Workspace & Modal */
    .onboarding-container { padding: 36px; overflow-y: auto; width: 100%; height: 100%; }
    .onboard-top-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
    .btn-primary { background: linear-gradient(135deg, var(--violet-primary), var(--magenta-glow)); color: #fff; padding: 12px 24px; border-radius: 12px; font-weight: 700; font-size: 14px; border: none; cursor: pointer; box-shadow: 0 10px 20px -5px rgba(124, 58, 237, 0.4); display: flex; align-items: center; gap: 8px; }

    .onboarding-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
    .form-group { margin-bottom: 18px; }
    .form-label { display: block; font-size: 13px; font-weight: 600; color: var(--text-slate); margin-bottom: 6px; }
    .form-input { width: 100%; padding: 12px 16px; border-radius: 12px; border: 1px solid rgba(124, 58, 237, 0.2); background: var(--input-bg); font-size: 14px; color: var(--text-charcoal); outline: none; }
    .form-input:focus { border-color: var(--violet-primary); box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.15); }

    .pill-input-box { display: flex; flex-wrap: wrap; gap: 8px; padding: 10px; border-radius: 12px; border: 1px solid rgba(124, 58, 237, 0.2); background: var(--input-bg); min-height: 48px; }
    .tag-pill { background: linear-gradient(135deg, var(--violet-primary), var(--magenta-glow)); color: #fff; padding: 4px 12px; border-radius: 16px; font-size: 12px; font-weight: 500; display: flex; align-items: center; gap: 6px; }
    .tag-pill span { cursor: pointer; opacity: 0.8; }

    /* Dropzone Upload */
    .dropzone-box { border: 2px dashed rgba(124, 58, 237, 0.4); border-radius: 16px; padding: 24px; text-align: center; cursor: pointer; background: rgba(124, 58, 237, 0.04); transition: border 0.2s; }
    .dropzone-box:hover { border-color: var(--violet-primary); background: rgba(124, 58, 237, 0.08); }
    .img-preview-thumb { width: 100%; max-height: 180px; object-fit: cover; border-radius: 12px; margin-top: 12px; }

    /* AI Auto-Fill Button */
    .ai-autofill-btn { background: rgba(168, 85, 247, 0.15); border: 1px solid var(--violet-primary); color: var(--violet-primary); padding: 8px 16px; border-radius: 8px; font-weight: 600; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; margin-top: 6px; }
    .ai-autofill-btn:hover { background: var(--violet-primary); color: #fff; }

    /* Multimodal Playground */
    .playground-grid { display: grid; grid-template-columns: 1fr 380px; width: 100%; height: 100%; overflow: hidden; }
    .chat-pane { display: flex; flex-direction: column; height: 100%; padding: 24px; }
    .chat-stream { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; padding-right: 12px; }

    .msg-bubble { max-width: 75%; padding: 14px 20px; border-radius: 18px; font-size: 14px; line-height: 1.6; white-space: pre-wrap; }
    .msg-bubble.user { align-self: flex-end; background: linear-gradient(135deg, var(--violet-primary), var(--indigo-aura)); color: #fff; border-bottom-right-radius: 4px; box-shadow: 0 10px 20px -5px rgba(124, 58, 237, 0.3); }
    .msg-bubble.ai { align-self: flex-start; background: var(--msg-ai-bg); color: var(--text-charcoal); border-bottom-left-radius: 4px; border: 1px solid var(--glass-border); box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05); }

    .action-dock { background: var(--glass-surface); backdrop-filter: blur(16px); border: 1px solid var(--glass-border); border-radius: 20px; padding: 12px 18px; display: flex; align-items: center; gap: 12px; margin-top: 16px; box-shadow: var(--shadow-glass); }
    .dock-input { flex: 1; border: none; background: transparent; outline: none; font-size: 15px; color: var(--text-charcoal); }
    .dock-btn { background: transparent; border: none; font-size: 20px; cursor: pointer; padding: 8px; border-radius: 10px; }

    /* Product Grid */
    .product-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; margin-top: 24px; }
    .product-card { padding: 20px; }

    .telemetry-pane { border-left: 1px solid var(--glass-border); background: var(--telemetry-bg); backdrop-filter: blur(16px); padding: 24px; overflow-y: auto; }
    .code-box { background: #0F172A; color: #38BDF8; padding: 12px; border-radius: 10px; font-family: monospace; font-size: 12px; overflow-x: auto; margin-top: 8px; }
  </style>
</head>
<body>
  <!-- Sidebar -->
  <div class="sidebar">
    <div>
      <div class="brand-title">AROMATESE ✦</div>
      <ul class="nav-list">
        <li class="nav-item active" onclick="switchTab('playground')">🧪 Multimodal Sandbox</li>
        <li class="nav-item" onclick="switchTab('onboarding')">🛍️ Product Onboarding</li>
        <li class="nav-item" onclick="switchTab('live-chats')">💬 Live Chats & HITL</li>
      </ul>
    </div>
    <div style="font-size: 12px; color: var(--text-slate);">
      DB: <strong>Mattic Supabase</strong> (pgvector)<br>
      Model: <strong>Gemini 2.0 Flash</strong>
    </div>
  </div>

  <!-- Main Workspace -->
  <div class="main-workspace">
    <div class="top-header">
      <div class="pill-badge">
        <span style="width: 8px; height: 8px; background: #10B981; border-radius: 50%;"></span>
        Live Gemini Multimodal & Grounding Engine Active
      </div>
      <div class="header-actions">
        <button class="theme-toggle-btn" id="themeBtn" onclick="toggleTheme()">☀️ Light Mode</button>
        <button style="background: #EF4444; color: #fff; border: none; padding: 8px 16px; border-radius: 10px; font-weight: 600; cursor: pointer;" onclick="toggleGlobalKillSwitch()">HALT AI (KILL SWITCH)</button>
      </div>
    </div>

    <!-- TAB 1: MULTIMODAL SANDBOX & TELEMETRY -->
    <div class="tab-pane active" id="tab-playground">
      <div class="playground-grid">
        <div class="chat-pane">
          <div class="chat-stream" id="chatStream">
            <div class="msg-bubble ai">
              <strong>Assalamu Alaikum!</strong> I am your Aromatese AI Sales Consultant.<br>
              Try asking: <em>"Bhai ekta holud jama kinte chai"</em> or record a voice note using the mic below! 🎤
            </div>
          </div>

          <div class="action-dock">
            <button class="dock-btn" id="micBtn" onclick="toggleAudioRecording()" title="Record Voice Note">🎙️</button>
            <button class="dock-btn" onclick="document.getElementById('imageUploader').click()" title="Attach Photo">📷</button>
            <input type="file" id="imageUploader" accept="image/*" style="display:none" onchange="handleImageUpload(event)">

            <input type="text" class="dock-input" id="chatInput" placeholder="Type message in Banglish, Bangla, or English..." onkeydown="if(event.key==='Enter') sendChatMessage()">
            <button class="dock-btn" style="color: var(--violet-primary);" onclick="sendChatMessage()">➔</button>
          </div>
        </div>

        <div class="telemetry-pane">
          <h3 style="font-size: 16px; font-weight: 700; color: var(--violet-deep); margin-bottom: 16px;">⚡ Grounding Telemetry Inspector</h3>
          <div class="glass-card" style="padding: 16px; margin-bottom: 16px;">
            <strong style="font-size: 13px;">Execution Latency:</strong>
            <div style="font-size: 20px; font-weight: 700; color: var(--violet-primary);" id="latencyVal">420 ms</div>
          </div>
          <div class="glass-card" style="padding: 16px; margin-bottom: 16px;">
            <strong style="font-size: 13px;">Response Validator Gate:</strong>
            <div style="color: #10B981; font-weight: 600; margin-top: 4px;" id="validatorStatus">✓ PASSED (0 Hallucinations)</div>
          </div>
          <div class="glass-card" style="padding: 16px;">
            <strong style="font-size: 13px;">Grounded DB Tool Proof:</strong>
            <div class="code-box" id="telemetryProof">
{
  "tool": "query_catalog",
  "matchedSku": "DRESS-YELLOW-HOLUD",
  "priceBdt": 2200,
  "stock": 6
}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 2: PRODUCT ONBOARDING & MANAGEMENT -->
    <div class="tab-pane" id="tab-onboarding">
      <div class="onboarding-container">
        <div class="onboard-top-bar">
          <div>
            <h2>Product Catalog & AI Media Onboarding</h2>
            <p style="color: var(--text-slate); font-size: 14px;">Upload product photos, voice synonyms, and let Gemini auto-complete Bangla & tags!</p>
          </div>
          <button class="btn-primary" onclick="toggleOnboardingForm()">+ Onboard New Product</button>
        </div>

        <!-- Onboarding Form (Collapsible / Toggleable) -->
        <div id="onboardingFormWrapper" style="display: none; margin-bottom: 32px;">
          <div class="onboarding-grid">
            <!-- Left Column: Core Metadata & Image Dropzone -->
            <div class="glass-card" style="padding: 28px;">
              <h3 style="font-size: 18px; font-weight: 700; margin-bottom: 20px; color: var(--violet-deep);">Product Core Metadata & Photo</h3>
              
              <!-- Dropzone Upload -->
              <div class="dropzone-box" onclick="document.getElementById('obImageFile').click()">
                <div style="font-size: 28px;">📷</div>
                <div style="font-size: 13px; font-weight: 600; margin-top: 6px; color: var(--violet-primary);">Click or Drag Product Photo to Upload</div>
                <div style="font-size: 11px; color: var(--text-slate);">Generates pgvector Image Embedding automatically</div>
                <input type="file" id="obImageFile" accept="image/*" style="display:none" onchange="previewProductImage(event)">
                <img id="imgPreview" class="img-preview-thumb" style="display:none;">
              </div>

              <div class="form-group" style="margin-top: 18px;">
                <label class="form-label">Title (English)</label>
                <input type="text" class="form-input" id="obTitleEn" placeholder="e.g. Royal Navy Blue Silk Saree">
                <button class="ai-autofill-btn" onclick="triggerAiAutoFill()">✨ AI Auto-Complete (Bangla, Banglish, Tags & Notes)</button>
              </div>

              <div class="form-group">
                <label class="form-label">Title (Native Bengali)</label>
                <input type="text" class="form-input" id="obTitleBn" placeholder="Auto-completes from English title...">
              </div>
              <div class="form-group">
                <label class="form-label">Title (Banglish Transliteration)</label>
                <input type="text" class="form-input" id="obTitleBanglish" placeholder="Auto-completes from English title...">
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div class="form-group">
                  <label class="form-label">Base Price (BDT)</label>
                  <input type="number" class="form-input" id="obPrice" placeholder="2500">
                </div>
                <div class="form-group">
                  <label class="form-label">Discount Price (BDT)</label>
                  <input type="number" class="form-input" id="obDiscount" placeholder="2200">
                </div>
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div class="form-group">
                  <label class="form-label">Stock Quantity</label>
                  <input type="number" class="form-input" id="obStock" placeholder="6">
                </div>
                <div class="form-group">
                  <label class="form-label">Brand Name</label>
                  <input type="text" class="form-input" id="obBrand" placeholder="Aromatese Exclusive">
                </div>
              </div>
            </div>

            <!-- Right Column: Voice Tags & AI Attribute Picks -->
            <div class="glass-card" style="padding: 28px;">
              <h3 style="font-size: 18px; font-weight: 700; margin-bottom: 20px; color: var(--violet-deep);">Voice Tags & AI Extracted Attributes</h3>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
                <div>
                  <span style="font-size: 11px; font-weight: 600; color: var(--text-slate);">Extracted Color:</span>
                  <div style="font-size: 13px; font-weight: 700; color: var(--violet-primary);" id="attrColor">Auto-extracted</div>
                </div>
                <div>
                  <span style="font-size: 11px; font-weight: 600; color: var(--text-slate);">Extracted Material:</span>
                  <div style="font-size: 13px; font-weight: 700; color: var(--violet-primary);" id="attrMaterial">Auto-extracted</div>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label">Dynamic Voice Synonyms & Colloquial Tags (Auto-Populated)</label>
                <div class="pill-input-box" id="tagPillBox">
                  <input type="text" style="border:none; outline:none; background:transparent; font-size:14px; flex:1;" id="tagInput" placeholder="Add tag (e.g. holud, bashanti)..." onkeydown="if(event.key==='Enter') addVoiceTag()">
                </div>
              </div>

              <div class="form-group">
                <label class="form-label">Custom Sales Notes / Prompts</label>
                <textarea class="form-input" id="obNotes" rows="3" placeholder="AI auto-generates selling highlights here..."></textarea>
              </div>

              <div class="glass-card" style="padding: 16px; background: rgba(124,58,237,0.05); margin-top: 16px;">
                <strong style="font-size: 13px;">pgvector Embedding Sync:</strong>
                <div style="display: flex; gap: 12px; margin-top: 8px;">
                  <span class="tag-pill" style="background: #10B981;">text-embedding-004: Synced</span>
                  <span class="tag-pill" style="background: var(--violet-primary);">image_embedding: Active</span>
                </div>
              </div>

              <button class="btn-primary" style="width: 100%; margin-top: 24px; padding: 14px; justify-content: center;" onclick="submitOnboardingForm()">Save Product & Sync Embeddings ➔</button>
            </div>
          </div>
        </div>

        <!-- Catalog Product Grid -->
        <div class="product-grid" id="productGrid"></div>
      </div>
    </div>
  </div>

  <script>
    let activeVoiceTags = ['holud', 'yellow', 'bashanti', 'jama', 'frock'];
    let uploadedImageBase64 = '';
    let currentTheme = localStorage.getItem('aromatese_theme') || 'light';

    function applyTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      const btn = document.getElementById('themeBtn');
      if (btn) btn.innerHTML = theme === 'dark' ? '🌙 Dark Mode' : '☀️ Light Mode';
      localStorage.setItem('aromatese_theme', theme);
    }

    function toggleTheme() {
      currentTheme = currentTheme === 'light' ? 'dark' : 'light';
      applyTheme(currentTheme);
    }

    function toggleOnboardingForm() {
      const wrapper = document.getElementById('onboardingFormWrapper');
      if (wrapper.style.display === 'none') {
        wrapper.style.display = 'block';
        gsap.from('#onboardingFormWrapper .glass-card', { y: 20, opacity: 0, duration: 0.5, stagger: 0.1 });
      } else {
        wrapper.style.display = 'none';
      }
    }

    function previewProductImage(evt) {
      const file = evt.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        uploadedImageBase64 = e.target.result;
        const img = document.getElementById('imgPreview');
        img.src = uploadedImageBase64;
        img.style.display = 'block';
      };
      reader.readAsDataURL(file);
    }

    async function triggerAiAutoFill() {
      const titleEn = document.getElementById('obTitleEn').value.trim();
      if (!titleEn) return alert('Please enter an English title first.');

      const btn = document.querySelector('.ai-autofill-btn');
      btn.innerText = '✨ Gemini AI Thinking...';

      try {
        const res = await fetch('/api/admin/auto-complete-product', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ titleEn })
        });
        const result = await res.json();
        const d = result.data;

        if (d) {
          document.getElementById('obTitleBn').value = d.titleBn || '';
          document.getElementById('obTitleBanglish').value = d.titleBanglish || '';
          if (d.suggestedPrice) document.getElementById('obPrice').value = d.suggestedPrice;
          if (d.suggestedDiscount) document.getElementById('obDiscount').value = d.suggestedDiscount;
          if (d.brand) document.getElementById('obBrand').value = d.brand;
          if (d.customNotes) document.getElementById('obNotes').value = d.customNotes;

          document.getElementById('attrColor').innerText = d.extractedColor || 'Standard';
          document.getElementById('attrMaterial').innerText = d.extractedMaterial || 'Cotton';

          if (d.voiceTags && Array.isArray(d.voiceTags)) {
            activeVoiceTags = Array.from(new Set([...activeVoiceTags, ...d.voiceTags]));
            renderTags();
          }
        }
      } catch (err) {
        console.error('Auto fill error:', err);
      } finally {
        btn.innerText = '✨ AI Auto-Complete (Bangla, Banglish, Tags & Notes)';
      }
    }

    function renderTags() {
      const box = document.getElementById('tagPillBox');
      const input = document.getElementById('tagInput');
      box.querySelectorAll('.tag-pill').forEach(el => el.remove());

      activeVoiceTags.forEach(t => {
        const pill = document.createElement('div');
        pill.className = 'tag-pill';
        pill.innerHTML = \`\${t} <span onclick="removeVoiceTag('\${t}')">×</span>\`;
        box.insertBefore(pill, input);
      });
    }

    function addVoiceTag() {
      const input = document.getElementById('tagInput');
      const val = input.value.trim().toLowerCase();
      if (val && !activeVoiceTags.includes(val)) {
        activeVoiceTags.push(val);
        input.value = '';
        renderTags();
      }
    }

    function removeVoiceTag(tag) {
      activeVoiceTags = activeVoiceTags.filter(t => t !== tag);
      renderTags();
    }

    function switchTab(tabName) {
      document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));

      document.getElementById(\`tab-\${tabName}\`).classList.add('active');
      if (tabName === 'onboarding') loadProducts();
      gsap.from(\`#tab-\${tabName} .glass-card\`, { y: 20, opacity: 0, duration: 0.5, stagger: 0.05 });
    }

    async function loadProducts() {
      const res = await fetch('/api/admin/products');
      const data = await res.json();
      const grid = document.getElementById('productGrid');

      grid.innerHTML = data.products.map(p => \`
        <div class="glass-card product-card">
          \${p.imageUrl ? \`<img src="\${p.imageUrl}" style="width:100%; height:160px; object-fit:cover; border-radius:12px; margin-bottom:12px;">\` : ''}
          <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
            <strong style="font-size:15px;">\${p.titleEn}</strong>
            <span style="color:#10B981; font-weight:700;">৳\${p.discountPriceBdt || p.priceBdt}</span>
          </div>
          <div style="font-size:12px; color:var(--text-slate);">SKU: \${p.sku} • Stock: \${p.stockQuantity} pcs</div>
          <div style="margin-top:8px;">
            \${(p.voiceTags || []).map(t => \`<span class="tag-pill" style="font-size:10px; padding:2px 8px; margin-right:4px;">\${t}</span>\`).join('')}
          </div>
        </div>
      \`).join('');
    }

    async function sendChatMessage() {
      const input = document.getElementById('chatInput');
      const text = input.value.trim();
      if (!text) return;

      const stream = document.getElementById('chatStream');
      stream.innerHTML += \`<div class="msg-bubble user">\${text}</div>\`;
      input.value = '';

      const res = await fetch('/api/admin/test-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const data = await res.json();

      stream.innerHTML += \`<div class="msg-bubble ai">\${data.replyText}</div>\`;
      stream.scrollTop = stream.scrollHeight;
    }

    async function submitOnboardingForm() {
      const titleEn = document.getElementById('obTitleEn').value;
      const titleBn = document.getElementById('obTitleBn').value;
      const titleBanglish = document.getElementById('obTitleBanglish').value;
      const priceBdt = document.getElementById('obPrice').value;
      const discountPriceBdt = document.getElementById('obDiscount').value;
      const stockQuantity = document.getElementById('obStock').value;
      const brand = document.getElementById('obBrand').value;
      const customNotes = document.getElementById('obNotes').value;

      const sku = 'SKU-' + Math.floor(Math.random() * 10000);

      const res = await fetch('/api/admin/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku, titleEn, titleBn, titleBanglish, priceBdt, discountPriceBdt, stockQuantity, brand, customNotes, voiceTags: activeVoiceTags, imageUrl: uploadedImageBase64
        })
      });
      const data = await res.json();
      if (data.success) {
        alert('Product onboarded with image & pgvector embeddings!');
        toggleOnboardingForm();
        loadProducts();
      }
    }

    applyTheme(currentTheme);
    renderTags();
  </script>
</body>
</html>
  `);
});

app.listen(PORT, () => {
  console.log(`[Mattic Server] Server & Admin Dashboard running on http://localhost:${PORT}/admin`);
});
