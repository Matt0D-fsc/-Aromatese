import { ILLMProvider, LLMMessageInput } from '../interfaces/ILLMProvider.js';
import { KillSwitch } from '../services/KillSwitch.js';
import { CatalogToolHandler, QUERY_CATALOG_TOOL_DEF, CHECK_STOCK_TOOL_DEF } from '../tools/CatalogTools.js';
import { ResponseValidator } from '../services/ResponseValidator.js';
import { AuditLogger } from '../services/AuditLogger.js';
import { VoiceProcessingService } from '../services/VoiceProcessingService.js';
import { ImageMatchService } from '../services/ImageMatchService.js';
import { IncomingWebhookJob } from '../interfaces/IMessageQueue.js';

export interface OutboundMessageResult {
  tenantId: string;
  channel: 'whatsapp' | 'messenger' | 'instagram';
  recipientId: string;
  replyText: string;
  isValidated: boolean;
  blockedByKillSwitch?: boolean;
  escalatedToHuman?: boolean;
  imageUrl?: string;
}

export interface ToolCallExecutedResult {
  toolName: string;
  args: any;
  result: any;
}

export class AgentOrchestrator {
  private llmProvider: ILLMProvider;
  private killSwitch: KillSwitch;
  private toolHandler: CatalogToolHandler;
  private validator: ResponseValidator;
  private auditLogger: AuditLogger;
  private voiceService?: VoiceProcessingService;
  private imageService?: ImageMatchService;
  private sessionHistoryMap: Map<string, LLMMessageInput[]> = new Map();

  constructor(
    llmProvider: ILLMProvider,
    killSwitch: KillSwitch,
    toolHandler: CatalogToolHandler,
    validator: ResponseValidator,
    auditLogger: AuditLogger,
    voiceService?: VoiceProcessingService,
    imageService?: ImageMatchService
  ) {
    this.llmProvider = llmProvider;
    this.killSwitch = killSwitch;
    this.toolHandler = toolHandler;
    this.validator = validator;
    this.auditLogger = auditLogger;
    this.voiceService = voiceService;
    this.imageService = imageService;
  }

  /**
   * Process an incoming customer message job (Text, Voice Audio, or Product Photo) through the complete agent pipeline.
   */
  public async processMessageJob(job: IncomingWebhookJob): Promise<OutboundMessageResult> {
    const { tenantId, channel, senderId, textContent, messageType } = job;

    // 1. Kill Switch Guard Check
    const killSwitchStatus = await this.killSwitch.canGenerateAiReply(tenantId);
    if (!killSwitchStatus.isAllowed) {
      await this.auditLogger.logEvent({
        tenantId,
        eventType: 'AI_REPLY_BLOCKED_BY_KILL_SWITCH',
        llmPrompt: textContent || `[${messageType}]`,
      });

      return {
        tenantId,
        channel,
        recipientId: senderId,
        replyText: '',
        isValidated: false,
        blockedByKillSwitch: true,
      };
    }

    let effectiveUserText = textContent || '';

    // 2. Multimodal Preprocessing: Audio Voice Note
    if (messageType === 'audio' && this.voiceService) {
      const mockAudioBuffer = Buffer.from('mock_voice_data_buffer');
      const voiceResult = await this.voiceService.processVoiceNote(mockAudioBuffer, 'audio/ogg');

      if (voiceResult.suggestedAction === 'escalate_to_human' || voiceResult.isUnclear) {
        return {
          tenantId,
          channel,
          recipientId: senderId,
          replyText: 'Dukkhto, apnar voice note ti spashto shona jacche na. Aamader human agent bolte sahajjo korbe.',
          isValidated: true,
          escalatedToHuman: true,
        };
      }

      effectiveUserText = voiceResult.transcript;
    }

    // 3. Multimodal Preprocessing: Product Photo Image
    if (messageType === 'image' && this.imageService) {
      const mockImageBuffer = Buffer.from('mock_image_data_buffer');
      const matchResult = await this.imageService.matchProductImage(tenantId, mockImageBuffer, 'image/jpeg');

      if (!matchResult.hasMatch || !matchResult.matchedProduct) {
        return {
          tenantId,
          channel,
          recipientId: senderId,
          replyText: `Picture ta dekhlam (${matchResult.description}). Dukkhto, exactly aita amader current stock e nai. Apni amader baki catalog query korte paren!`,
          isValidated: true,
        };
      }

      const p = matchResult.matchedProduct;
      effectiveUserText = `Image matching product found: ${p.titleEn} (SKU: ${p.sku}, Price: ${p.priceBdt} BDT, Stock: ${p.stockQuantity} pcs). Offer to customer.`;
    }

    const systemPrompt = `You are an authentic, conversational, warm, and highly persuasive AI sales consultant for a Bangladeshi e-commerce store.
Rules:
1. LANGUAGE: Converse naturally in Bangla, English, or Banglish (Romanized Bengali) matching the customer's language style.
2. CONVERSATIONAL MEMORY & CONTEXT: Remember the full conversation context! When the customer asks follow-up questions (e.g., "chobi dekha jabe", "ghori ta ki blue?", "color ki?"), answer directly about the product currently under discussion in the chat history.
3. NO DEAD ENDS & OUT OF STOCK ALTERNATIVES: If a product is out of stock (stock 0 pcs), explain politely and immediately offer top 2-3 similar in-stock products from catalog tools!
4. SHOWING PRODUCT PHOTOS: If a customer asks to see pictures/photos ("chobi dekhan", "picture dekha jabe", "photo ache?"), or when recommending an item, check if the product has an image URL and include markdown image links like ![Product Title](imageUrl) or direct image links in your response!
5. NEVER GUESS PRICES: Call query_catalog or check_stock when looking up prices or stock numbers.`;

    const userMessage = effectiveUserText || 'Hello';

    // Retrieve conversation history for senderId
    const historyKey = `${tenantId}:${senderId}`;
    const currentHistory = this.sessionHistoryMap.get(historyKey) || [];

    const conversationTurn: LLMMessageInput[] = [
      ...currentHistory,
      { role: 'user', content: userMessage },
    ];

    // 4. First Turn LLM Generation with Grounding Tools
    const initialLlmResponse = await this.llmProvider.generateResponse(
      conversationTurn,
      {
        systemPrompt,
        tools: [QUERY_CATALOG_TOOL_DEF, CHECK_STOCK_TOOL_DEF],
        tenantId,
      }
    );

    const executedTools: ToolCallExecutedResult[] = [];

    // 5. Execute Tool Calls if requested by LLM
    if (initialLlmResponse.toolCalls && initialLlmResponse.toolCalls.length > 0) {
      for (const call of initialLlmResponse.toolCalls) {
        const res = await this.toolHandler.executeTool(tenantId, call.name, call.args);
        executedTools.push({ toolName: res.toolName, args: call.args, result: res.result });
      }
    }

    let finalReplyText = initialLlmResponse.text;

    // 6. Second Turn LLM Generation if tools were executed
    if (executedTools.length > 0) {
      const followUpPrompt = `Tool Execution Results: ${JSON.stringify(executedTools)}. Generate a clear, persuasive, conversational response in Banglish/Bangla matching the customer's exact question, providing prices, stock, and image links if available.`;
      const secondLlmResponse = await this.llmProvider.generateResponse(
        [
          ...conversationTurn,
          { role: 'assistant', content: `[Executed tools: ${executedTools.map(t => t.toolName).join(', ')}]` },
          { role: 'user', content: followUpPrompt },
        ],
        { systemPrompt, tenantId }
      );
      finalReplyText = secondLlmResponse.text;
    }

    // 7. Post-Generation Response Validator Safety Check
    const validationResult = this.validator.validateReply(finalReplyText, executedTools);

    if (!validationResult.isValid && executedTools.length > 0) {
      console.warn(`[AgentOrchestrator] Post-Generation Validator rejected reply: ${validationResult.rejectedReason}`);

      const productsList = (executedTools[0].result as any)?.products;
      const singleProduct = (executedTools[0].result as any)?.product;

      if (productsList && productsList.length > 0) {
        if (productsList.length === 1) {
          const p = productsList[0];
          const imageLink = p.imageUrl ? `\n![${p.titleEn}](${p.imageUrl})` : '';
          finalReplyText = `Haa, ${p.titleEn || p.titleBn} ekhon ache. Price ${p.priceBdt} BDT, stock ${p.stockQuantity} pcs.${imageLink}\nDelivery lagbe ki?`;
        } else {
          const itemsText = productsList.map((p: any, i: number) => `${i + 1}. ${p.titleEn} - Price ${p.priceBdt} BDT (Stock ${p.stockQuantity} pcs)`).join('\n');
          finalReplyText = `Haa, amader kache ${productsList.length} ta item ache:\n${itemsText}\nApni kon ta dekhben?`;
        }
      } else if (singleProduct && singleProduct.priceBdt) {
        const imageLink = singleProduct.imageUrl ? `\n![${singleProduct.titleEn}](${singleProduct.imageUrl})` : '';
        finalReplyText = `Haa, ${singleProduct.titleEn || singleProduct.titleBn} ekhon ache. Price ${singleProduct.priceBdt} BDT, stock ${singleProduct.stockQuantity} pcs.${imageLink}\nDelivery lagbe ki?`;
      } else {
        finalReplyText = `Dukkhto, apnar requested product ti amader current stock e nai. Apni amader baki catalog query korte paren!`;
      }
    }

    // Update conversation session history
    currentHistory.push({ role: 'user', content: userMessage });
    currentHistory.push({ role: 'assistant', content: finalReplyText });
    if (currentHistory.length > 20) {
      currentHistory.splice(0, currentHistory.length - 20);
    }
    this.sessionHistoryMap.set(historyKey, currentHistory);

    // 8. Audit Logging
    await this.auditLogger.logEvent({
      tenantId,
      eventType: 'AI_REPLY_SENT',
      llmPrompt: userMessage,
      llmRawResponse: finalReplyText,
      toolCalls: executedTools.map(t => ({ name: t.toolName, result: t.result })) as Record<string, unknown>[],
      groundingProof: validationResult.groundedValues as any,
    });

    return {
      tenantId,
      channel,
      recipientId: senderId,
      replyText: finalReplyText,
      isValidated: true,
    };
  }

  public clearHistory(tenantId: string, senderId: string): void {
    const historyKey = `${tenantId}:${senderId}`;
    this.sessionHistoryMap.delete(historyKey);
  }
}
