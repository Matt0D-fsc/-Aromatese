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

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const catalogService = new CatalogService();
const toolHandler = new CatalogToolHandler(catalogService);
const geminiProvider = new GeminiLLMProvider(process.env.GEMINI_API_KEY);
const killSwitch = new KillSwitch();
const validator = new ResponseValidator();
const auditLogsList: any[] = [];
const auditLogger = new AuditLogger({
  insertLog: async (entry) => { auditLogsList.push(entry); }
});

const webhookGateway = new MetaWebhookGateway();
const messageQueue = new MessageQueue();

const orchestrator = new AgentOrchestrator(
  geminiProvider,
  killSwitch,
  toolHandler,
  validator,
  auditLogger
);

const DEFAULT_TENANT_ID = 'tenant-bd-fashion-001';

// Seed initial products with voice tags & custom notes
catalogService.upsertProducts(DEFAULT_TENANT_ID, [
  {
    sku: 'DRESS-BLUE-MIDI',
    titleEn: 'Blue Cotton Midi Dress',
    titleBn: 'নীল সুতি মিডি ড্রেস',
    titleBanglish: 'blue suti midi dress neel',
    priceBdt: 1500,
    stockQuantity: 5,
    isActive: true,
    voiceTags: ['neel', 'blue', 'dress', 'midi', 'নীল'],
    customNotes: 'Made of 100% breathable organic cotton, comfortable for everyday wear.',
  },
  {
    sku: 'DRESS-BLUE-MAXI',
    titleEn: 'Royal Blue Floral Maxi Dress',
    titleBn: 'রয়্যাল ব্লু ফ্লোরাল ম্যাক্সি ড্রেস',
    titleBanglish: 'royal blue floral maxi dress neel',
    priceBdt: 2200,
    stockQuantity: 3,
    isActive: true,
    voiceTags: ['neel', 'blue', 'royal blue', 'maxi', 'dress', 'নীল'],
    customNotes: 'Premium Georgette fabric with golden zari embroidery.',
  },
]);

// In-Memory state for Live Admin Dashboard
const activeConversations: any[] = [
  {
    id: 'conv-101',
    tenantId: DEFAULT_TENANT_ID,
    customerName: 'Rahim Chowdhury',
    phone: '01712345678',
    channel: 'whatsapp',
    status: 'bot',
    aiMuted: false,
    lastMessage: 'Bhai ekta neel dress ase apnader?',
    lastMessageAt: new Date().toISOString(),
    messages: [
      { sender: 'customer', text: 'Salam, apnader dress ache?', time: '10:00 AM' },
      { sender: 'bot', text: 'Walaikum Assalam! Haa, amader vibinno type er dress ache. Kon color ba style dekhben?', time: '10:01 AM' },
      { sender: 'customer', text: 'Bhai ekta neel dress ase apnader?', time: '10:02 AM' },
      { sender: 'bot', text: 'Haa, amader kache 2 ta neel dress ache:\n1. Blue Cotton Midi Dress - Price 1500 BDT (Stock 5 pcs)\n2. Royal Blue Floral Maxi Dress - Price 2200 BDT (Stock 3 pcs)\nApni kon ta dekhben?', time: '10:02 AM', groundingProof: { sku: 'DRESS-BLUE-MIDI', matchedCount: 2 } },
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
  try {
    const { text, messageType } = req.body;
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
    return res.json(reply);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// --- CATALOG PRODUCTS MANAGEMENT REST API ---
app.get('/api/admin/products', async (req: Request, res: Response) => {
  const products = await catalogService.searchCatalog({ tenantId: DEFAULT_TENANT_ID, limit: 100 });
  res.json({ products });
});

app.post('/api/admin/products', async (req: Request, res: Response) => {
  try {
    const { sku, titleEn, titleBn, titleBanglish, priceBdt, stockQuantity, voiceTags, customNotes } = req.body;

    const tagsArray = typeof voiceTags === 'string' ? voiceTags.split(',').map((t: string) => t.trim()) : voiceTags;

    await catalogService.upsertProducts(DEFAULT_TENANT_ID, [
      {
        sku,
        titleEn,
        titleBn,
        titleBanglish,
        priceBdt: parseFloat(priceBdt),
        stockQuantity: parseInt(stockQuantity, 10),
        voiceTags: tagsArray || [],
        customNotes,
        isActive: true,
      },
    ]);

    return res.json({ success: true });
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

// --- FRONTEND UI DASHBOARD & PLAYGROUND ---
app.get('/admin', (req: Request, res: Response) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mattic AI — Merchant Control & Playground Workspace</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-dark: #0b0f19;
      --card-bg: rgba(22, 30, 49, 0.7);
      --card-border: rgba(255, 255, 255, 0.08);
      --accent-blue: #3b82f6;
      --accent-green: #10b981;
      --accent-purple: #8b5cf6;
      --accent-red: #ef4444;
      --text-main: #f3f4f6;
      --text-muted: #9ca3af;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Outfit', sans-serif; }
    body { background: var(--bg-dark); color: var(--text-main); display: flex; height: 100vh; overflow: hidden; }

    /* Sidebar */
    .sidebar { width: 280px; background: rgba(15, 23, 42, 0.95); border-right: 1px solid var(--card-border); padding: 24px; display: flex; flex-direction: column; justify-content: space-between; }
    .brand { font-size: 22px; font-weight: 700; background: linear-gradient(135deg, #60a5fa, #a855f7); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .nav-links { margin-top: 32px; list-style: none; }
    .nav-item { padding: 12px 16px; margin-bottom: 8px; border-radius: 8px; cursor: pointer; color: var(--text-muted); font-weight: 500; transition: all 0.2s; }
    .nav-item.active, .nav-item:hover { background: rgba(59, 130, 246, 0.15); color: #fff; border-left: 3px solid var(--accent-blue); }

    /* Main Container */
    .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .header { height: 70px; border-bottom: 1px solid var(--card-border); padding: 0 32px; display: flex; align-items: center; justify-content: space-between; background: rgba(15, 23, 42, 0.5); backdrop-filter: blur(12px); }
    .status-badge { display: flex; align-items: center; gap: 8px; font-size: 14px; padding: 6px 14px; border-radius: 20px; background: rgba(16, 185, 129, 0.1); color: var(--accent-green); border: 1px solid rgba(16, 185, 129, 0.2); }
    .kill-switch-btn { background: var(--accent-red); color: #fff; border: none; padding: 8px 18px; border-radius: 8px; font-weight: 600; cursor: pointer; }

    /* Tabs Content */
    .tab-view { display: none; height: calc(100vh - 70px); }
    .tab-view.active { display: flex; }

    /* Column 1: Conversations List */
    .chats-col { width: 360px; border-right: 1px solid var(--card-border); overflow-y: auto; }
    .chat-card { padding: 16px 20px; border-bottom: 1px solid var(--card-border); cursor: pointer; }
    .chat-card.active { background: rgba(255, 255, 255, 0.04); }

    /* Column 2: Live Message Stream */
    .stream-col { flex: 1; display: flex; flex-direction: column; background: rgba(11, 15, 25, 0.5); }
    .stream-header { padding: 16px 24px; border-bottom: 1px solid var(--card-border); display: flex; justify-content: space-between; align-items: center; }
    .messages-box { flex: 1; padding: 24px; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; }
    .msg-bubble { max-width: 75%; padding: 12px 16px; border-radius: 12px; font-size: 14px; line-height: 1.5; white-space: pre-wrap; }
    .msg-bubble.customer { align-self: flex-start; background: rgba(255, 255, 255, 0.08); border: 1px solid var(--card-border); }
    .msg-bubble.bot { align-self: flex-end; background: linear-gradient(135deg, #1e3a8a, #3b82f6); color: #fff; }

    /* Column 3: Audit Panel */
    .audit-col { width: 340px; border-left: 1px solid var(--card-border); padding: 24px; background: rgba(15, 23, 42, 0.4); overflow-y: auto; }
    .code-block { background: #000; padding: 10px; border-radius: 6px; font-family: monospace; font-size: 12px; color: #10b981; margin-top: 8px; }

    /* Product Manager View */
    .catalog-view { flex: 1; padding: 32px; overflow-y: auto; }
    .product-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; margin-top: 24px; }
    .product-card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 12px; padding: 20px; }
    .tag-badge { font-size: 11px; background: rgba(139, 92, 246, 0.2); color: #c084fc; padding: 3px 8px; border-radius: 12px; margin-right: 4px; display: inline-block; margin-top: 6px; }

    /* Playground View */
    .playground-view { flex: 1; display: flex; flex-direction: column; max-width: 900px; margin: 0 auto; padding: 32px; }
    .input-row { display: flex; gap: 12px; margin-top: 16px; }
    .chat-input { flex: 1; padding: 14px 18px; border-radius: 10px; border: 1px solid var(--card-border); background: rgba(255, 255, 255, 0.05); color: #fff; font-size: 15px; }
    .send-btn { background: var(--accent-blue); color: #fff; border: none; padding: 0 24px; border-radius: 10px; font-weight: 600; cursor: pointer; }
  </style>
</head>
<body>
  <!-- Sidebar -->
  <div class="sidebar">
    <div>
      <div class="brand">MATTIC AI ⚡</div>
      <ul class="nav-links">
        <li class="nav-item active" onclick="switchTab('live-chats')">💬 Live Conversations</li>
        <li class="nav-item" onclick="switchTab('playground')">🧪 AI Test Playground</li>
        <li class="nav-item" onclick="switchTab('products')">🛍️ Product Manager & Media</li>
        <li class="nav-item" onclick="switchTab('orders')">📦 Orders & COD</li>
      </ul>
    </div>
    <div style="font-size: 12px; color: var(--text-muted);">
      Connected DB: <strong>Mattic Supabase</strong><br>
      Region: <strong>ap-southeast-1</strong>
    </div>
  </div>

  <!-- Main View -->
  <div class="main">
    <div class="header">
      <div class="status-badge">
        <span style="width: 8px; height: 8px; background: var(--accent-green); border-radius: 50%;"></span>
        AI Engine & Grounding Active
      </div>
      <button class="kill-switch-btn" onclick="toggleGlobalKillSwitch()">HALT ALL AI (KILL SWITCH)</button>
    </div>

    <!-- TAB 1: LIVE CHATS -->
    <div class="tab-view active" id="tab-live-chats">
      <div class="chats-col" id="chatList"></div>
      <div class="stream-col">
        <div class="stream-header">
          <div>
            <h3 id="activeChatName">Rahim Chowdhury</h3>
            <span style="font-size: 12px; color: var(--text-muted);" id="activeChatPhone">01712345678 • WhatsApp</span>
          </div>
          <button style="padding: 8px 16px; border-radius: 8px; border: 1px solid var(--accent-blue); background: rgba(59, 130, 246, 0.1); color: var(--accent-blue); font-weight: 600; cursor: pointer;" id="takeoverBtn" onclick="toggleTakeover()">Take Over Chat (Mute AI)</button>
        </div>
        <div class="messages-box" id="messageStream"></div>
      </div>
      <div class="audit-col">
        <div style="font-size: 16px; font-weight: 600; margin-bottom: 16px;">Grounding Audit Proof</div>
        <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--card-border); padding: 14px; border-radius: 8px;">
          <strong>Dual-Field Grounding:</strong>
          <div class="code-block">
{
  "sku": "DRESS-BLUE-MIDI",
  "priceBdt": 1500,
  "stockQuantity": 5,
  "disambiguationMatched": 2
}
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 2: AI TEST PLAYGROUND -->
    <div class="tab-view" id="tab-playground">
      <div class="playground-view">
        <h2 style="margin-bottom: 8px;">AI Agent Testing Playground</h2>
        <p style="color: var(--text-muted); margin-bottom: 24px;">Test how the AI handles complex customer voice transcripts (e.g. "Bhai ekta neel dress ase apnader?"), Banglish queries, and product recommendations live before deploying to Meta webhooks.</p>

        <div style="flex: 1; border: 1px solid var(--card-border); border-radius: 12px; padding: 24px; overflow-y: auto; background: rgba(11,15,25,0.5);" id="playgroundStream">
          <div class="msg-bubble bot">Salam! I am your AI sales assistant. Try asking: "Bhai ekta neel dress ase apnader?" or "White cotton panjabi koto?"</div>
        </div>

        <div class="input-row">
          <input type="text" class="chat-input" id="playgroundInput" placeholder="Type customer query or voice transcript (e.g. Bhai ekta neel dress ase apnader?)" onkeydown="if(event.key==='Enter') sendPlaygroundMsg()">
          <button class="send-btn" onclick="sendPlaygroundMsg()">Send Query</button>
        </div>
      </div>
    </div>

    <!-- TAB 3: PRODUCT MANAGER -->
    <div class="tab-view" id="tab-products">
      <div class="catalog-view">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <h2>Product Catalog & Voice Media Tags</h2>
            <p style="color: var(--text-muted);">Add product photos, voice synonyms (e.g., "neel", "suti"), and custom sales notes.</p>
          </div>
          <button style="background: var(--accent-green); color: #fff; border: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; cursor: pointer;" onclick="showAddProductModal()">+ Add New Product</button>
        </div>

        <div class="product-grid" id="productGrid"></div>
      </div>
    </div>
  </div>

  <script>
    let activeConvId = 'conv-101';
    let conversationsData = [];

    function switchTab(tabName) {
      document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.tab-view').forEach(el => el.classList.remove('active'));

      document.getElementById(\`tab-\${tabName}\`).classList.add('active');
      if (tabName === 'products') loadProducts();
    }

    async function loadData() {
      const res = await fetch('/api/admin/conversations');
      const data = await res.json();
      conversationsData = data.conversations;
      renderChats();
      renderActiveStream();
    }

    function renderChats() {
      const listEl = document.getElementById('chatList');
      listEl.innerHTML = conversationsData.map(c => \`
        <div class="chat-card \${c.id === activeConvId ? 'active' : ''}" onclick="selectChat('\${c.id}')">
          <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
            <strong style="font-size:15px;">\${c.customerName}</strong>
            <span style="font-size:11px; padding:2px 8px; border-radius:12px; background:rgba(255,255,255,0.1);">\${c.channel}</span>
          </div>
          <div style="font-size:13px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">\${c.lastMessage}</div>
        </div>
      \`).join('');
    }

    function selectChat(id) { activeConvId = id; renderChats(); renderActiveStream(); }

    function renderActiveStream() {
      const conv = conversationsData.find(c => c.id === activeConvId);
      if (!conv) return;

      document.getElementById('activeChatName').innerText = conv.customerName;
      document.getElementById('activeChatPhone').innerText = \`\${conv.phone} • \${conv.channel}\`;

      const streamEl = document.getElementById('messageStream');
      streamEl.innerHTML = conv.messages.map(m => \`
        <div class="msg-bubble \${m.sender}">
          <div>\${m.text}</div>
          <div style="font-size: 10px; opacity: 0.7; margin-top: 4px; text-align: right;">\${m.time}</div>
        </div>
      \`).join('');
    }

    async function sendPlaygroundMsg() {
      const input = document.getElementById('playgroundInput');
      const text = input.value.trim();
      if (!text) return;

      const stream = document.getElementById('playgroundStream');
      stream.innerHTML += \`<div class="msg-bubble customer"><strong>Customer Voice/Text:</strong><br>\${text}</div>\`;
      input.value = '';

      const res = await fetch('/api/admin/test-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const data = await res.json();

      stream.innerHTML += \`<div class="msg-bubble bot"><strong>AI Agent Response (Grounded):</strong><br>\${data.replyText}</div>\`;
      stream.scrollTop = stream.scrollHeight;
    }

    async function loadProducts() {
      const res = await fetch('/api/admin/products');
      const data = await res.json();
      const grid = document.getElementById('productGrid');

      grid.innerHTML = data.products.map(p => \`
        <div class="product-card">
          <div style="display:flex; justify-content:space-between;">
            <strong style="font-size:16px;">\${p.titleEn}</strong>
            <span style="color:var(--accent-green); font-weight:700;">৳\${p.priceBdt}</span>
          </div>
          <div style="font-size:13px; color:var(--text-muted); margin-top:4px;">SKU: \${p.sku} • Stock: \${p.stockQuantity} pcs</div>
          <div style="margin-top:10px;">
            \${(p.voiceTags || []).map(t => \`<span class="tag-badge">\${t}</span>\`).join('')}
          </div>
          <div style="font-size:12px; color:var(--text-muted); margin-top:10px; font-style:italic;">
            "\${p.customNotes || 'No custom prompt notes'}"
          </div>
        </div>
      \`).join('');
    }

    async function showAddProductModal() {
      const titleEn = prompt('Product Title (English):', 'Navy Blue Casual Shirt');
      const priceBdt = prompt('Price in BDT (Taka):', '1650');
      const stockQuantity = prompt('Stock Quantity:', '12');
      const voiceTags = prompt('Voice Synonym Tags (comma separated):', 'neel, blue, shirt, navy');
      const sku = 'SHIRT-NAVY-' + Math.floor(Math.random() * 1000);

      if (titleEn && priceBdt) {
        await fetch('/api/admin/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sku, titleEn, priceBdt, stockQuantity, voiceTags })
        });
        loadProducts();
      }
    }

    loadData();
  </script>
</body>
</html>
  `);
});

app.listen(PORT, () => {
  console.log(`[Mattic Server] Server & Admin Dashboard running on http://localhost:${PORT}/admin`);
});
