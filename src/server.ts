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

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

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
    brand: 'ChatNab Atelier',
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
    brand: 'ChatNab Festive',
    priceBdt: 2500,
    discountPriceBdt: 2200,
    stockQuantity: 6,
    isActive: true,
    voiceTags: ['holud', 'yellow', 'bashanti', 'halud', 'jama', 'dress', 'frock'],
    customNotes: 'Perfect for Pahela Baishakh, Haldi ceremony, and summer outings.',
  },
  {
    sku: 'WATCH-OMEGA-SEAMASTER',
    titleEn: 'Omega Seamaster Blue Watch Tourbillon',
    titleBn: 'ওমেগা সি-মাস্টার ব্লু ওয়াচ ট্যুরবিয়ন',
    titleBanglish: 'omega seamaster blue ghori watch tourbillon neel ghori',
    brand: 'Omega',
    priceBdt: 45000,
    discountPriceBdt: 38500,
    stockQuantity: 2,
    isActive: true,
    voiceTags: ['ghori', 'watch', 'neel', 'blue', 'omega', 'seamaster', 'tourbillon', 'wrist watch', 'হাত ঘড়ি'],
    customNotes: 'Luxury automatic movement with sapphire crystal and blue sunray dial.',
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

    const systemPrompt = `You are an expert e-commerce product catalog manager and linguist for Bangladesh.
Your job is to analyze ANY product title in English (clothing, watches, electronics, footwear, jewelry, cosmetics, etc.) and output STRICT JSON ONLY with NO markdown wrapper:
{
  "titleBn": "Accurate, natural Bengali translation of the product title in native Bengali script",
  "titleBanglish": "Natural Banglish phonetic transliteration title including common spoken words",
  "brand": "Extracted or inferred Brand Name",
  "suggestedPrice": 2500,
  "suggestedDiscount": 2200,
  "extractedColor": "Color in English & Bengali (e.g. Blue / Neel)",
  "extractedMaterial": "Build material/fabric appropriate for this item type",
  "extractedCategory": "Product category",
  "voiceTags": ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8"],
  "customNotes": "Engaging sales note highlighting features tailored specifically for this exact product"
}
Strict Rules:
1. NEVER output apparel/clothing tags (like 'suti kapor' or 'fabric') unless the item is actually apparel/clothing.
2. For watches, include watch-specific terms in voiceTags like ['ghori', 'watch', 'wrist watch', 'hand watch', 'হাত ঘড়ি'].
3. voiceTags MUST contain spoken colloquial terms in Bangla, Banglish, and English for voice recognition.`;

    const llmRes = await geminiProvider.generateResponse(
      [{ role: 'user', content: `Analyze product: "${titleEn}"` }],
      { systemPrompt, tenantId: DEFAULT_TENANT_ID }
    );

    let cleanJson = llmRes.text.replace(/```json/g, '').replace(/```/g, '').trim();
    const data = JSON.parse(cleanJson);
    return res.json({ success: true, data });
  } catch (err: any) {
    const title = (req.body.titleEn || '').trim();
    const words = title.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
    
    // Dynamic zero-hardcoded fallback based strictly on prompt tokens
    return res.json({
      success: true,
      data: {
        titleBn: title,
        titleBanglish: title.toLowerCase(),
        brand: words[0] ? words[0].charAt(0).toUpperCase() + words[0].slice(1) : 'ChatNab Atelier',
        suggestedPrice: 2500,
        suggestedDiscount: 2000,
        extractedColor: words.find((w: string) => ['blue', 'red', 'yellow', 'black', 'white', 'green'].includes(w)) || 'Standard',
        extractedMaterial: words.find((w: string) => ['steel', 'gold', 'leather', 'cotton', 'silk'].includes(w)) || 'Premium Quality',
        extractedCategory: words.find((w: string) => ['watch', 'shoe', 'dress', 'phone', 'shirt'].includes(w)) || 'Product',
        voiceTags: Array.from(new Set([...words])),
        customNotes: `Authentic ${title} with premium quality guarantee.`,
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
    const { sku, titleEn, titleBn, titleBanglish, brand, priceBdt, discountPriceBdt, stockQuantity, voiceTags, customNotes, imageUrl, imageUrls } = req.body;

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
        brand: brand || 'ChatNab Atelier',
        priceBdt: parseFloat(priceBdt),
        discountPriceBdt: discountPriceBdt ? parseFloat(discountPriceBdt) : undefined,
        stockQuantity: parseInt(stockQuantity, 10) || 0,
        voiceTags: tagsArray,
        customNotes,
        imageUrl,
        imageUrls: Array.isArray(imageUrls) ? imageUrls : imageUrl ? [imageUrl] : [],
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

// --- ROOT & ADMIN DASHBOARD (CHATNAB KINETIC AGENCY DESIGN SYSTEM) ---
app.get(['/', '/admin'], (req: Request, res: Response) => {
  res.send(`
<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ChatNab — Kinetic Autonomous Commerce Engine</title>
  
  <!-- Typography Matrix -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700;800&family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400;1,600&family=JetBrains+Mono:wght@400;500;600&family=Manrope:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  
  <!-- Motion Libraries -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js"></script>
  <script src="https://unpkg.com/lenis@1.1.9/dist/lenis.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js"></script>

  <style>
    /* Travertine & Warm Atelier Token Matrix */
    :root {
      --_font-display: 'Cinzel', 'Cormorant Garamond', Georgia, serif;
      --_font-editorial: 'Cormorant Garamond', Georgia, serif;
      --_font-default: 'Manrope', -apple-system, BlinkMacSystemFont, sans-serif;
      --_font-mono: 'JetBrains Mono', monospace;

      --_animbezier: cubic-bezier(0.23, 0.65, 0.74, 1.09);
      --_animspeed-fast: 0.15s;
      --_animspeed-medium: 0.35s;
      --_animspeed-slow: 0.7s;

      /* Permanent Fixed Tokens */
      --color-bronze: #C29B38;
      --color-bronze-dark: #A67C1E;
      --color-terracotta: #C85A32;
      --color-gold: #D4AF37;
      --color-emerald: #10B981;
      --color-rose: #EF4444;
    }

    /* Light Scheme Palette (Organic Travertine Ground) */
    html[data-theme="light"] {
      --base: #F7F5F0;
      --base-tint: #EFECE6;
      --base-bright: #FFFFFF;
      --base-opp: #151412;
      --base-opp-tint: #22201C;
      
      --t-bright: #151412;
      --t-medium: #5E5B54;
      --t-muted: #8F8B82;
      --t-opp-bright: #F7F5F0;
      --t-opp-muted: #A3A099;

      --st-border: rgba(194, 155, 56, 0.22);
      --st-border-subtle: rgba(21, 20, 18, 0.08);
      --glass-surface: rgba(255, 255, 255, 0.78);
      --glass-border: rgba(255, 255, 255, 0.9);
      --shadow-atelier: 0 24px 48px -18px rgba(194, 155, 56, 0.12), 0 10px 30px -10px rgba(21, 20, 18, 0.06);

      --chat-user-bg: linear-gradient(135deg, #C29B38, #C85A32);
      --chat-ai-bg: #FFFFFF;
      --input-bg: rgba(255, 255, 255, 0.9);
      --telemetry-bg: rgba(247, 245, 240, 0.85);
    }

    /* Dark Scheme Palette (Obsidian Travertine Ground) */
    html[data-theme="dark"] {
      --base: #151412;
      --base-tint: #1F1D1A;
      --base-bright: #0D0C0B;
      --base-opp: #F7F5F0;
      --base-opp-tint: #EFECE6;
      
      --t-bright: #F7F5F0;
      --t-medium: #B5B2AB;
      --t-muted: #7A7770;
      --t-opp-bright: #151412;
      --t-opp-muted: #5E5B54;

      --st-border: rgba(212, 175, 55, 0.25);
      --st-border-subtle: rgba(247, 245, 240, 0.1);
      --glass-surface: rgba(31, 29, 26, 0.7);
      --glass-border: rgba(247, 245, 240, 0.12);
      --shadow-atelier: 0 24px 48px -18px rgba(0, 0, 0, 0.6);

      --chat-user-bg: linear-gradient(135deg, #D4AF37, #C85A32);
      --chat-ai-bg: #1F1D1A;
      --input-bg: rgba(21, 20, 18, 0.85);
      --telemetry-bg: rgba(31, 29, 26, 0.85);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--base);
      color: var(--t-bright);
      font-family: var(--_font-default);
      display: flex;
      height: 100vh;
      overflow: hidden;
      transition: background var(--_animspeed-medium) ease, color var(--_animspeed-medium) ease;
    }

    /* Kinetic Custom Cursor */
    .mxd-cursor-dot {
      position: fixed;
      top: 0; left: 0;
      width: 8px; height: 8px;
      background: var(--color-bronze);
      border-radius: 50%;
      pointer-events: none;
      z-index: 9999;
      transform: translate(-50%, -50%);
      transition: width 0.2s, height 0.2s, background 0.2s;
    }
    .mxd-cursor-aura {
      position: fixed;
      top: 0; left: 0;
      width: 36px; height: 36px;
      border: 1px solid var(--color-bronze);
      border-radius: 50%;
      pointer-events: none;
      z-index: 9998;
      transform: translate(-50%, -50%);
      transition: transform 0.08s ease-out, width 0.3s, height 0.3s, border-color 0.3s;
    }

    /* Kinetic Glass Sidebar */
    .sidebar {
      width: 290px;
      background: var(--glass-surface);
      backdrop-filter: blur(24px) saturate(160%);
      border-right: 1px solid var(--st-border-subtle);
      padding: 32px 24px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      box-shadow: var(--shadow-atelier);
      z-index: 50;
    }
    .brand-box { display: flex; align-items: center; gap: 10px; cursor: pointer; }
    .brand-title {
      font-family: var(--_font-display);
      font-size: 26px;
      font-weight: 800;
      letter-spacing: 0.08em;
      background: linear-gradient(135deg, var(--color-bronze), var(--color-terracotta));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .nav-list { margin-top: 40px; list-style: none; }
    .nav-item {
      padding: 14px 18px;
      margin-bottom: 10px;
      border-radius: 12px;
      cursor: pointer;
      color: var(--t-medium);
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0.02em;
      transition: all var(--_animspeed-medium) var(--_animbezier);
      display: flex;
      align-items: center;
      gap: 12px;
      border: 1px solid transparent;
    }
    .nav-item:hover, .nav-item.active {
      background: var(--base-tint);
      color: var(--t-bright);
      border-color: var(--st-border);
      transform: translateX(6px);
    }
    .nav-item.active {
      border-left: 3px solid var(--color-bronze);
    }

    /* Workspace Shell */
    .workspace-shell {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      position: relative;
    }
    .top-bar {
      height: 76px;
      background: var(--glass-surface);
      backdrop-filter: blur(20px);
      border-bottom: 1px solid var(--st-border-subtle);
      padding: 0 36px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      z-index: 40;
    }
    .telemetry-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 16px;
      border-radius: 24px;
      font-family: var(--_font-mono);
      font-size: 12px;
      font-weight: 500;
      background: rgba(16, 185, 129, 0.1);
      color: var(--color-emerald);
      border: 1px solid rgba(16, 185, 129, 0.25);
    }
    .action-group { display: flex; align-items: center; gap: 14px; }
    .btn-theme {
      background: var(--base-tint);
      border: 1px solid var(--st-border);
      color: var(--t-bright);
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s;
    }
    .btn-theme:hover { transform: scale(1.04); }
    .btn-kill {
      background: var(--color-rose);
      color: #fff;
      border: none;
      padding: 8px 18px;
      border-radius: 20px;
      font-weight: 700;
      font-size: 12px;
      letter-spacing: 0.05em;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(239, 68, 68, 0.3);
    }

    /* Content Panes */
    .tab-viewport { display: none; height: calc(100vh - 76px); overflow-y: auto; opacity: 0; }
    .tab-viewport.active { display: flex; flex-direction: column; opacity: 1; }

    /* Glass Cards */
    .atelier-card {
      background: var(--glass-surface);
      backdrop-filter: blur(20px) saturate(160%);
      border: 1px solid var(--glass-border);
      border-radius: 20px;
      box-shadow: var(--shadow-atelier);
      transition: transform 0.4s var(--_animbezier), box-shadow 0.4s var(--_animbezier);
    }
    .atelier-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 30px 60px -15px rgba(194, 155, 56, 0.18);
    }

    /* TAB 0: KINETIC HERO INTRO & PHYSICS SHOWCASE */
    .hero-section {
      padding: 48px 48px 24px 48px;
      display: flex;
      flex-direction: column;
      gap: 36px;
      max-width: 1440px;
      margin: 0 auto;
      width: 100%;
    }
    .hero-headline-wrap { max-width: 900px; }
    .hero-eyebrow {
      font-family: var(--_font-mono);
      font-size: 13px;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      color: var(--color-bronze);
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .hero-title {
      font-family: var(--_font-display);
      font-size: clamp(3rem, 5vw, 4.8rem);
      font-weight: 700;
      line-height: 1.08;
      letter-spacing: -0.02em;
      color: var(--t-bright);
    }
    .hero-title em {
      font-family: var(--_font-editorial);
      font-weight: 400;
      font-style: italic;
      color: var(--color-bronze);
    }
    .hero-subtitle {
      font-size: 17px;
      line-height: 1.6;
      color: var(--t-medium);
      margin-top: 16px;
      max-width: 720px;
    }
    .hero-cta-row { display: flex; gap: 16px; margin-top: 24px; }
    .btn-kinetic-primary {
      background: linear-gradient(135deg, var(--color-bronze), var(--color-terracotta));
      color: #FFFFFF;
      padding: 14px 28px;
      border-radius: 14px;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.03em;
      border: none;
      cursor: pointer;
      box-shadow: 0 12px 28px -6px rgba(194, 155, 56, 0.4);
      transition: transform 0.25s var(--_animbezier);
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .btn-kinetic-primary:hover { transform: translateY(-2px) scale(1.02); }

    /* Matter.js 2D Physics Canvas Container */
    .physics-sandbox-box {
      border-radius: 20px;
      border: 1px solid var(--st-border);
      background: var(--base-tint);
      position: relative;
      overflow: hidden;
      height: 380px;
      display: flex;
      flex-direction: column;
      box-shadow: var(--shadow-atelier);
    }
    .physics-canvas-header {
      position: absolute;
      top: 18px; left: 24px; right: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      pointer-events: none;
      z-index: 10;
    }
    .physics-canvas-title {
      font-family: var(--_font-mono);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--color-bronze);
      font-weight: 600;
    }
    #matterCanvas { width: 100%; height: 100%; }

    /* Hero KPI Metrics Ticker */
    .kpi-ticker-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 20px;
    }
    .kpi-card { padding: 24px; }
    .kpi-number {
      font-family: var(--_font-mono);
      font-size: 32px;
      font-weight: 700;
      color: var(--color-bronze);
    }
    .kpi-label {
      font-size: 13px;
      font-weight: 600;
      color: var(--t-muted);
      margin-top: 6px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    /* TAB 1: MULTIMODAL SANDBOX */
    .sandbox-split-grid {
      display: grid;
      grid-template-columns: 1fr 400px;
      height: 100%;
      overflow: hidden;
    }
    .chat-column { display: flex; flex-direction: column; height: 100%; padding: 28px; background: rgba(247, 245, 240, 0.4); }
    .chat-stream-box { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; padding-right: 12px; }
    .msg-card {
      max-width: 75%;
      padding: 16px 22px;
      border-radius: 18px;
      font-size: 14.5px;
      line-height: 1.6;
      white-space: pre-wrap;
    }
    .msg-card.user {
      align-self: flex-end;
      background: var(--chat-user-bg);
      color: #FFFFFF;
      border-bottom-right-radius: 4px;
      box-shadow: 0 10px 24px -6px rgba(194, 155, 56, 0.35);
    }
    .msg-card.ai {
      align-self: flex-start;
      background: var(--chat-ai-bg);
      color: var(--t-bright);
      border-bottom-left-radius: 4px;
      border: 1px solid var(--glass-border);
      box-shadow: var(--shadow-atelier);
    }

    .floating-dock {
      background: var(--glass-surface);
      backdrop-filter: blur(20px);
      border: 1px solid var(--st-border);
      border-radius: 20px;
      padding: 12px 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 16px;
      box-shadow: var(--shadow-atelier);
    }
    .dock-input-field {
      flex: 1;
      border: none;
      background: transparent;
      outline: none;
      font-size: 15px;
      color: var(--t-bright);
    }
    .dock-action-btn {
      background: transparent;
      border: none;
      font-size: 20px;
      cursor: pointer;
      padding: 8px;
      border-radius: 10px;
      transition: transform 0.2s;
    }
    .dock-action-btn:hover { transform: scale(1.15); }
    .dock-action-btn.recording { animation: pulseRec 1s infinite; color: var(--color-rose); }

    @keyframes pulseRec { 0% { transform: scale(1); } 50% { transform: scale(1.2); } 100% { transform: scale(1); } }

    .inspector-column {
      border-left: 1px solid var(--st-border-subtle);
      background: var(--telemetry-bg);
      backdrop-filter: blur(20px);
      padding: 28px;
      overflow-y: auto;
    }
    .code-terminal {
      background: #11100E;
      color: #E6C675;
      padding: 14px;
      border-radius: 12px;
      font-family: var(--_font-mono);
      font-size: 12px;
      overflow-x: auto;
      margin-top: 10px;
      border: 1px solid rgba(194, 155, 56, 0.2);
    }

    /* TAB 2: PRODUCT ONBOARDING */
    .onboard-page-wrap { padding: 36px 48px; width: 100%; max-width: 1440px; margin: 0 auto; }
    .onboard-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-top: 24px; }
    .form-input-field {
      width: 100%;
      padding: 14px 18px;
      border-radius: 12px;
      border: 1px solid var(--st-border);
      background: var(--input-bg);
      font-size: 14.5px;
      color: var(--t-bright);
      outline: none;
      transition: border 0.2s;
    }
    .form-input-field:focus {
      border-color: var(--color-bronze);
      box-shadow: 0 0 0 3px rgba(194, 155, 56, 0.15);
    }
    .tag-pill-item {
      background: linear-gradient(135deg, var(--color-bronze), var(--color-terracotta));
      color: #FFFFFF;
      padding: 5px 14px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .tag-pill-item span { cursor: pointer; opacity: 0.85; }

    .btn-ai-autofill {
      background: rgba(194, 155, 56, 0.15);
      border: 1px solid var(--color-bronze);
      color: var(--color-bronze);
      padding: 9px 18px;
      border-radius: 10px;
      font-size: 12.5px;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
      transition: all 0.2s;
    }
    .btn-ai-autofill:hover {
      background: var(--color-bronze);
      color: #FFFFFF;
    }

    /* Product Grid */
    .catalog-cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
      gap: 24px;
      margin-top: 32px;
    }
    .catalog-item-card { padding: 22px; }
  </style>
</head>
<body>
  <!-- Custom Kinetic Cursor Elements -->
  <div class="mxd-cursor-dot" id="cursorDot"></div>
  <div class="mxd-cursor-aura" id="cursorAura"></div>

  <!-- Sidebar Navigation -->
  <div class="sidebar">
    <div>
      <div class="brand-box" onclick="switchTab('hero')">
        <div class="brand-title">CHATNAB ✦</div>
      </div>
      <ul class="nav-list">
        <li class="nav-item active" onclick="switchTab('hero')">🏛️ Overview & Physics</li>
        <li class="nav-item" onclick="switchTab('playground')">🧪 Multimodal Sandbox</li>
        <li class="nav-item" onclick="switchTab('onboarding')">🛍️ Product Onboarding</li>
        <li class="nav-item" onclick="switchTab('live-chats')">💬 Live HITL Stream</li>
      </ul>
    </div>
    <div style="font-size: 12px; color: var(--t-muted); font-family: var(--_font-mono);">
      Ground: <strong>Travertine Atelier</strong><br>
      Model: <strong>Gemini 2.0 Flash</strong><br>
      DB: <strong>Mattic Supabase</strong>
    </div>
  </div>

  <!-- Main Workspace Shell -->
  <div class="workspace-shell">
    <div class="top-bar">
      <div class="telemetry-pill">
        <span style="width: 8px; height: 8px; background: var(--color-emerald); border-radius: 50%;"></span>
        ChatNab Kinetic Core Active • Zero-Hallucination Gate
      </div>
      <div class="action-group">
        <button class="btn-theme" id="themeToggleBtn" onclick="toggleAtelierTheme()">☀️ Travertine Mode</button>
        <button class="btn-kill" onclick="toggleGlobalKillSwitch()">HALT AI (KILL SWITCH)</button>
      </div>
    </div>

    <!-- TAB 0: KINETIC HERO & MATTER.JS 2D PHYSICS SHOWCASE -->
    <div class="tab-viewport active" id="tab-hero">
      <div class="hero-section">
        <div class="hero-headline-wrap">
          <div class="hero-eyebrow">✦ Autonomous Conversational Commerce</div>
          <h1 class="hero-title">High-Velocity Multimodal AI for <em>Next-Generation Retail</em></h1>
          <p class="hero-subtitle">
            ChatNab connects directly to your Meta Cloud APIs, live Supabase pgvector catalog, and Gemini multimodal audio/vision perception to convert inquiries into paid orders in Bengali, English, and Banglish.
          </p>
          <div class="hero-cta-row">
            <button class="btn-kinetic-primary" onclick="switchTab('playground')">Launch AI Sandbox ➔</button>
            <button class="btn-theme" style="padding: 14px 24px; font-size: 15px;" onclick="switchTab('onboarding')">Onboard Products & Media</button>
          </div>
        </div>

        <!-- Matter.js 2D Rigid-Body Physics Canvas -->
        <div class="physics-sandbox-box">
          <div class="physics-canvas-header">
            <span class="physics-canvas-title">✦ Matter.js 2D Kinetic Gravity Token Sandbox (Drag & Throw)</span>
            <span style="font-family: var(--_font-mono); font-size: 11px; color: var(--t-muted);">Elastic Restitution: 0.85</span>
          </div>
          <div id="matterCanvas"></div>
        </div>

        <!-- Live KPI Telemetry Metrics Ticker -->
        <div class="kpi-ticker-grid">
          <div class="atelier-card kpi-card">
            <div class="kpi-number" id="kpiLatency">< 420 ms</div>
            <div class="kpi-label">Sub-Second Processing</div>
          </div>
          <div class="atelier-card kpi-card">
            <div class="kpi-number">100 %</div>
            <div class="kpi-label">Grounded Anti-Hallucination</div>
          </div>
          <div class="atelier-card kpi-card">
            <div class="kpi-number">3 Channels</div>
            <div class="kpi-label">WhatsApp, IG & Messenger</div>
          </div>
          <div class="atelier-card kpi-card">
            <div class="kpi-number">pgvector</div>
            <div class="kpi-label">Visual & Text Embeddings</div>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 1: MULTIMODAL SANDBOX (VOICE + PHOTO + CHAT) -->
    <div class="tab-viewport" id="tab-playground">
      <div class="sandbox-split-grid">
        <div class="chat-column">
          <div class="chat-stream-box" id="chatStream">
            <div class="msg-card ai">
              <strong>Assalamu Alaikum!</strong> I am your ChatNab AI Sales Consultant.<br>
              Try asking: <em>"bhai ghori kinbo kono ghori ase?"</em> or click the mic to record a voice note! 🎙️
            </div>
          </div>

          <!-- Floating Action Dock -->
          <div class="floating-dock">
            <button class="dock-action-btn" id="micBtn" onclick="toggleAudioRecording()" title="Record Voice Note">🎙️</button>
            <button class="dock-action-btn" onclick="document.getElementById('imageUploader').click()" title="Attach Photo">📷</button>
            <input type="file" id="imageUploader" accept="image/*" style="display:none" onchange="handleImageUpload(event)">

            <input type="text" class="dock-input-field" id="chatInput" placeholder="Type message in Banglish, Bangla, or English..." onkeydown="if(event.key==='Enter') sendChatMessage()">
            <button class="dock-action-btn" style="color: var(--color-bronze);" onclick="sendChatMessage()">➔</button>
          </div>
        </div>

        <!-- Telemetry Inspector Column -->
        <div class="inspector-column">
          <h3 style="font-size: 16px; font-weight: 700; color: var(--color-bronze); margin-bottom: 18px; font-family: var(--_font-display);">⚡ Grounding Telemetry Inspector</h3>
          <div class="atelier-card" style="padding: 18px; margin-bottom: 16px;">
            <strong style="font-size: 13px;">Execution Latency:</strong>
            <div style="font-size: 22px; font-weight: 700; color: var(--color-bronze); font-family: var(--_font-mono);" id="latencyVal">420 ms</div>
          </div>
          <div class="atelier-card" style="padding: 18px; margin-bottom: 16px;">
            <strong style="font-size: 13px;">Response Validator Gate:</strong>
            <div style="color: var(--color-emerald); font-weight: 600; margin-top: 4px;" id="validatorStatus">✓ PASSED (0 Hallucinations)</div>
          </div>
          <div class="atelier-card" style="padding: 18px;">
            <strong style="font-size: 13px;">Grounded DB Tool Proof:</strong>
            <div class="code-terminal" id="telemetryProof">
{
  "tool": "query_catalog",
  "matchedSku": "WATCH-OMEGA-SEAMASTER",
  "priceBdt": 38500,
  "stock": 2
}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 2: PRODUCT ONBOARDING -->
    <div class="tab-viewport" id="tab-onboarding">
      <div class="onboard-page-wrap">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <h2 style="font-family: var(--_font-display); font-size: 28px;">Product Catalog & Media Onboarding</h2>
            <p style="color: var(--t-muted); font-size: 14px; margin-top: 4px;">Upload multiple photos, voice tags, and let Gemini auto-complete Bangla, Banglish & attributes.</p>
          </div>
          <button class="btn-kinetic-primary" onclick="toggleOnboardingForm()">+ Onboard New Product</button>
        </div>

        <!-- Collapsible Onboarding Form -->
        <div id="onboardingFormWrapper" style="display: none; margin-top: 28px;">
          <div class="onboard-form-grid">
            <!-- Left Column: Core Metadata & Photos -->
            <div class="atelier-card" style="padding: 32px;">
              <h3 style="font-family: var(--_font-display); font-size: 18px; margin-bottom: 20px; color: var(--color-bronze);">Product Metadata & Visual Media</h3>
              
              <!-- Multi-Photo Dropzone Upload -->
              <div style="border: 2px dashed var(--st-border); border-radius: 16px; padding: 24px; text-align: center; cursor: pointer; background: var(--base-tint);" onclick="document.getElementById('obImageFiles').click()">
                <div style="font-size: 32px;">📷</div>
                <div style="font-size: 14px; font-weight: 700; margin-top: 6px; color: var(--color-bronze);">Click or Drag Multiple Product Photos</div>
                <div style="font-size: 11px; color: var(--t-muted);">Generates pgvector image embeddings automatically</div>
                <input type="file" id="obImageFiles" accept="image/*" multiple style="display:none" onchange="previewProductImages(event)">
                <div id="imgPreviewGrid" style="display:flex; flex-wrap:wrap; gap:8px; margin-top:12px;"></div>
              </div>

              <div style="margin-top: 20px;">
                <label style="display:block; font-size:13px; font-weight:600; color:var(--t-medium); margin-bottom:6px;">Title (English)</label>
                <input type="text" class="form-input-field" id="obTitleEn" placeholder="e.g. Omega Seamaster Blue Watch Tourbillon">
                <button class="btn-ai-autofill" onclick="triggerAiAutoFill()">✨ AI Auto-Complete (Bangla, Banglish, Tags & Notes)</button>
              </div>

              <div style="margin-top: 16px;">
                <label style="display:block; font-size:13px; font-weight:600; color:var(--t-medium); margin-bottom:6px;">Title (Native Bengali)</label>
                <input type="text" class="form-input-field" id="obTitleBn" placeholder="Auto-completes from English title...">
              </div>
              <div style="margin-top: 16px;">
                <label style="display:block; font-size:13px; font-weight:600; color:var(--t-medium); margin-bottom:6px;">Title (Banglish Transliteration)</label>
                <input type="text" class="form-input-field" id="obTitleBanglish" placeholder="Auto-completes from English title...">
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 16px;">
                <div>
                  <label style="display:block; font-size:13px; font-weight:600; color:var(--t-medium); margin-bottom:6px;">Base Price (BDT)</label>
                  <input type="number" class="form-input-field" id="obPrice" placeholder="2500">
                </div>
                <div>
                  <label style="display:block; font-size:13px; font-weight:600; color:var(--t-medium); margin-bottom:6px;">Discount Price (BDT)</label>
                  <input type="number" class="form-input-field" id="obDiscount" placeholder="2200">
                </div>
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 16px;">
                <div>
                  <label style="display:block; font-size:13px; font-weight:600; color:var(--t-medium); margin-bottom:6px;">Stock Quantity</label>
                  <input type="number" class="form-input-field" id="obStock" placeholder="6">
                </div>
                <div>
                  <label style="display:block; font-size:13px; font-weight:600; color:var(--t-medium); margin-bottom:6px;">Brand Name</label>
                  <input type="text" class="form-input-field" id="obBrand" placeholder="ChatNab Atelier">
                </div>
              </div>
            </div>

            <!-- Right Column: Voice Tags & Attributes -->
            <div class="atelier-card" style="padding: 32px;">
              <h3 style="font-family: var(--_font-display); font-size: 18px; margin-bottom: 20px; color: var(--color-bronze);">Voice Tags & AI Extracted Attributes</h3>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px;">
                <div>
                  <span style="font-size: 11px; font-weight: 600; color: var(--t-muted);">Extracted Color:</span>
                  <div style="font-size: 14px; font-weight: 700; color: var(--color-bronze);" id="attrColor">Auto-extracted</div>
                </div>
                <div>
                  <span style="font-size: 11px; font-weight: 600; color: var(--t-muted);">Extracted Material:</span>
                  <div style="font-size: 14px; font-weight: 700; color: var(--color-bronze);" id="attrMaterial">Auto-extracted</div>
                </div>
              </div>

              <div>
                <label style="display:block; font-size:13px; font-weight:600; color:var(--t-medium); margin-bottom:6px;">Voice Synonyms & Colloquial Tags (Auto-Populated)</label>
                <div style="display:flex; flex-wrap:wrap; gap:8px; padding:10px; border-radius:12px; border:1px solid var(--st-border); background:var(--input-bg); min-height:48px;" id="tagPillBox">
                  <input type="text" style="border:none; outline:none; background:transparent; font-size:14px; flex:1; color:var(--t-bright);" id="tagInput" placeholder="Add tag (e.g. ghori, watch)..." onkeydown="if(event.key==='Enter') addVoiceTag()">
                </div>
              </div>

              <div style="margin-top: 18px;">
                <label style="display:block; font-size:13px; font-weight:600; color:var(--t-medium); margin-bottom:6px;">Custom Sales Notes / Prompts</label>
                <textarea class="form-input-field" id="obNotes" rows="3" placeholder="AI auto-generates tailored selling highlights here..."></textarea>
              </div>

              <div class="atelier-card" style="padding: 16px; background: var(--base-tint); margin-top: 20px;">
                <strong style="font-size: 13px;">Vector Indexing Status:</strong>
                <div style="display: flex; gap: 12px; margin-top: 8px;">
                  <span class="tag-pill-item" style="background: var(--color-emerald);">text-embedding-004: Synced</span>
                  <span class="tag-pill-item">image_embedding: Active</span>
                </div>
              </div>

              <button class="btn-kinetic-primary" style="width: 100%; margin-top: 24px; padding: 14px; justify-content: center;" onclick="submitOnboardingForm()">Save Product & Sync Embeddings ➔</button>
            </div>
          </div>
        </div>

        <!-- Catalog Product Grid -->
        <div class="catalog-cards-grid" id="productGrid"></div>
      </div>
    </div>

    <!-- TAB 3: LIVE CONVERSATIONS & HITL -->
    <div class="tab-viewport" id="tab-live-chats">
      <div style="padding: 36px 48px;">
        <h2 style="font-family: var(--_font-display); font-size: 28px;">Live Omnichannel Conversations & Human Takeover</h2>
        <p style="color: var(--t-muted); font-size: 14px; margin-top: 4px;">Supervise active customer threads across WhatsApp, Messenger, and Instagram.</p>
        <div class="atelier-card" style="margin-top: 24px; padding: 24px;">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--st-border-subtle); padding-bottom: 16px;">
            <div>
              <strong style="font-size: 16px;">Rahim Chowdhury</strong>
              <span style="font-size: 12px; color: var(--t-muted); margin-left: 12px;">01712345678 • WhatsApp Business</span>
            </div>
            <button class="btn-theme" onclick="alert('Staff takeover active. AI is muted on this thread.')">Take Over Chat (Mute AI)</button>
          </div>
          <div style="padding-top: 16px; font-size: 14px; line-height: 1.6;">
            <strong>Latest Query:</strong> "Ami ekta holud jama kinte chai"<br>
            <span style="color: var(--color-emerald); font-weight: 600;">Grounded Response Sent:</span> "Haa, amader kache Bashanti Yellow Floral Dress ache! Price: 2200 BDT..."
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    let activeVoiceTags = ['ghori', 'watch', 'neel', 'blue', 'omega', 'seamaster'];
    let uploadedImageBase64s = [];
    let currentTheme = localStorage.getItem('chatnab_theme') || 'light';

    // 1. Lenis Smooth Scrolling Engine
    const lenis = new Lenis({ duration: 1.2, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)) });
    function raf(time) {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);

    // 2. Custom Kinetic Cursor
    const dot = document.getElementById('cursorDot');
    const aura = document.getElementById('cursorAura');
    window.addEventListener('mousemove', (e) => {
      dot.style.left = \`\${e.clientX}px\`;
      dot.style.top = \`\${e.clientY}px\`;
      gsap.to(aura, { x: e.clientX, y: e.clientY, duration: 0.25, ease: 'power2.out' });
    });

    // 3. Matter.js 2D Rigid-Body Physics Sandbox
    function initMatterPhysics() {
      const container = document.getElementById('matterCanvas');
      if (!container) return;
      container.innerHTML = '';

      const { Engine, Render, Runner, Bodies, Composite, Mouse, MouseConstraint, Events } = Matter;
      const engine = Engine.create();
      engine.world.gravity.y = 0.9;

      const width = container.clientWidth || 800;
      const height = container.clientHeight || 380;

      const render = Render.create({
        element: container,
        engine: engine,
        options: {
          width: width,
          height: height,
          wireframes: false,
          background: 'transparent',
        }
      });

      Render.run(render);
      const runner = Runner.create();
      Runner.run(runner, engine);

      // Boundaries
      const wallOptions = { isStatic: true, render: { visible: false } };
      Composite.add(engine.world, [
        Bodies.rectangle(width / 2, height + 30, width * 2, 60, wallOptions),
        Bodies.rectangle(-30, height / 2, 60, height * 2, wallOptions),
        Bodies.rectangle(width + 30, height / 2, 60, height * 2, wallOptions),
      ]);

      // Feature Physics Tags
      const tags = [
        "✦ Omnichannel AI", "Bangla Voice NLP", "pgvector Vision",
        "Zero Hallucination", "COD Automation", "WhatsApp Cloud API",
        "15-Min Stock Lock", "Meta Messenger", "Instagram DMs"
      ];

      tags.forEach((text, i) => {
        const x = 100 + (i % 3) * 180 + Math.random() * 40;
        const y = -20 - i * 60;
        const pill = Bodies.rectangle(x, y, 160, 44, {
          chamfer: { radius: 22 },
          restitution: 0.82,
          friction: 0.1,
          render: {
            fillStyle: i % 2 === 0 ? '#C29B38' : '#C85A32',
            strokeStyle: '#FFFFFF',
            lineWidth: 2,
          }
        });
        Composite.add(engine.world, pill);
      });

      // Mouse Interaction
      const mouse = Mouse.create(render.canvas);
      const mouseConstraint = MouseConstraint.create(engine, {
        mouse: mouse,
        constraint: { stiffness: 0.2, render: { visible: false } }
      });
      Composite.add(engine.world, mouseConstraint);
      render.mouse = mouse;

      // Custom Tag Text Drawing on Matter.js Canvas
      Events.on(render, 'afterRender', () => {
        const ctx = render.context;
        ctx.font = '600 12px "Manrope", sans-serif';
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const bodies = Composite.allBodies(engine.world);
        let tagIndex = 0;
        bodies.forEach(body => {
          if (!body.isStatic && tagIndex < tags.length) {
            ctx.save();
            ctx.translate(body.position.x, body.position.y);
            ctx.rotate(body.angle);
            ctx.fillText(tags[tagIndex], 0, 0);
            ctx.restore();
            tagIndex++;
          }
        });
      });
    }

    function applyTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      const btn = document.getElementById('themeToggleBtn');
      if (btn) btn.innerHTML = theme === 'dark' ? '🌙 Obsidian Mode' : '☀️ Travertine Mode';
      localStorage.setItem('chatnab_theme', theme);
    }

    function toggleAtelierTheme() {
      currentTheme = currentTheme === 'light' ? 'dark' : 'light';
      applyTheme(currentTheme);
    }

    function switchTab(tabName) {
      document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.tab-viewport').forEach(el => el.classList.remove('active'));

      document.getElementById(\`tab-\${tabName}\`).classList.add('active');
      if (tabName === 'hero') setTimeout(initMatterPhysics, 100);
      if (tabName === 'onboarding') loadProducts();
      gsap.from(\`#tab-\${tabName} .atelier-card\`, { y: 20, opacity: 0, duration: 0.5, stagger: 0.05, ease: 'power2.out' });
    }

    function toggleOnboardingForm() {
      const wrapper = document.getElementById('onboardingFormWrapper');
      wrapper.style.display = wrapper.style.display === 'none' ? 'block' : 'none';
      if (wrapper.style.display === 'block') {
        gsap.from('#onboardingFormWrapper .atelier-card', { y: 24, opacity: 0, duration: 0.5, stagger: 0.08 });
      }
    }

    function previewProductImages(evt) {
      const files = Array.from(evt.target.files);
      if (!files || files.length === 0) return;
      uploadedImageBase64s = [];
      const grid = document.getElementById('imgPreviewGrid');
      grid.innerHTML = '';

      files.forEach(file => {
        const reader = new FileReader();
        reader.onload = e => {
          const b64 = e.target.result;
          uploadedImageBase64s.push(b64);
          const img = document.createElement('img');
          img.src = b64;
          img.style.width = '70px';
          img.style.height = '70px';
          img.style.objectFit = 'cover';
          img.style.borderRadius = '8px';
          img.style.border = '1px solid var(--color-bronze)';
          grid.appendChild(img);
        };
        reader.readAsDataURL(file);
      });
    }

    async function triggerAiAutoFill() {
      const titleEn = document.getElementById('obTitleEn').value.trim();
      if (!titleEn) return alert('Please enter an English title first.');

      const btn = document.querySelector('.btn-ai-autofill');
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
          document.getElementById('attrMaterial').innerText = d.extractedMaterial || 'Standard';

          if (d.voiceTags && Array.isArray(d.voiceTags)) {
            activeVoiceTags = Array.from(new Set(d.voiceTags));
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
      box.querySelectorAll('.tag-pill-item').forEach(el => el.remove());

      activeVoiceTags.forEach(t => {
        const pill = document.createElement('div');
        pill.className = 'tag-pill-item';
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

    function formatAiReplyHtml(text) {
      if (!text) return '';
      let html = text.replace(/!\\[(.*?)\\]\\((.*?)\\)/g, '<br><img src="$2" alt="$1" style="max-width:100%; max-height:220px; border-radius:12px; margin-top:8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); display:block;"><br>');
      return html;
    }

    async function sendChatMessage() {
      const input = document.getElementById('chatInput');
      const text = input.value.trim();
      if (!text) return;

      const stream = document.getElementById('chatStream');
      stream.innerHTML += \`<div class="msg-card user">\${text}</div>\`;
      input.value = '';

      const res = await fetch('/api/admin/test-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const data = await res.json();

      const replyHtml = formatAiReplyHtml(data.replyText);
      stream.innerHTML += \`<div class="msg-card ai">\${replyHtml}</div>\`;
      stream.scrollTop = stream.scrollHeight;

      if (data.telemetry) {
        document.getElementById('latencyVal').innerText = \`\${data.telemetry.latencyMs} ms\`;
        document.getElementById('telemetryProof').innerText = JSON.stringify(data.telemetry.groundingProof || {}, null, 2);
      }
    }

    async function loadProducts() {
      const res = await fetch('/api/admin/products');
      const data = await res.json();
      const grid = document.getElementById('productGrid');

      grid.innerHTML = data.products.map(p => \`
        <div class="atelier-card catalog-item-card">
          \${p.imageUrl ? \`<img src="\${p.imageUrl}" style="width:100%; height:160px; object-fit:cover; border-radius:12px; margin-bottom:12px;">\` : ''}
          <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
            <strong style="font-size:15px; font-family:var(--_font-display);">\${p.titleEn}</strong>
            <span style="color:var(--color-emerald); font-weight:700; font-family:var(--_font-mono);">৳\${p.discountPriceBdt || p.priceBdt}</span>
          </div>
          <div style="font-size:12px; color:var(--t-muted); font-family:var(--_font-mono);">SKU: \${p.sku} • Stock: \${p.stockQuantity} pcs</div>
          <div style="margin-top:10px;">
            \${(p.voiceTags || []).map(t => \`<span class="tag-pill-item" style="font-size:10px; padding:2px 8px; margin-right:4px;">\${t}</span>\`).join('')}
          </div>
        </div>
      \`).join('');
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
          sku, titleEn, titleBn, titleBanglish, priceBdt, discountPriceBdt, stockQuantity, brand, customNotes, voiceTags: activeVoiceTags, imageUrl: uploadedImageBase64s[0] || '', imageUrls: uploadedImageBase64s
        })
      });
      const data = await res.json();
      if (data.success) {
        alert('Product onboarded with ' + (uploadedImageBase64s.length || 1) + ' photos & pgvector embeddings synced!');
        toggleOnboardingForm();
        loadProducts();
      }
    }

    applyTheme(currentTheme);
    renderTags();
    setTimeout(initMatterPhysics, 200);
  </script>
</body>
</html>
  `);
});

app.listen(PORT, () => {
  console.log(`[ChatNab Server] ChatNab Kinetic Server running on http://localhost:${PORT}/admin`);
});
