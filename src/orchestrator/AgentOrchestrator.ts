import { ILLMProvider } from '../interfaces/ILLMProvider.js';
import { IncomingWebhookJob } from '../interfaces/IMessageQueue.js';
import { KillSwitch } from '../services/KillSwitch.js';
import { CatalogToolHandler, QUERY_CATALOG_TOOL_DEF, CHECK_STOCK_TOOL_DEF } from '../tools/CatalogTools.js';
import { ResponseValidator, ToolCallExecutedResult } from '../services/ResponseValidator.js';
import { AuditLogger } from '../services/AuditLogger.js';
import { VoiceProcessingService } from '../services/VoiceProcessingService.js';
import { ImageMatchService } from '../services/ImageMatchService.js';

export interface OutboundMessageResult {
  tenantId: string;
  channel: string;
  recipientId: string;
  replyText: string;
  isValidated: boolean;
  blockedByKillSwitch?: boolean;
  escalatedToHuman?: boolean;
}

export class AgentOrchestrator {
  private llmProvider: ILLMProvider;
  private killSwitch: KillSwitch;
  private toolHandler: CatalogToolHandler;
  private validator: ResponseValidator;
  private auditLogger: AuditLogger;
  private voiceService?: VoiceProcessingService;
  private imageService?: ImageMatchService;

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

    const systemPrompt = `You are a helpful, polite, and persuasive AI sales assistant for a Bangladeshi e-commerce / F-commerce store.
Rules:
1. You converse naturally in Bangla, English, or Banglish (Romanized Bengali) matching the customer's language style.
2. NEVER guess prices or stock numbers. ALWAYS call query_catalog or check_stock first to retrieve real numbers.
3. If an item is out of stock, offer close available alternatives politely.
4. DISAMBIGUATION & RECOMMENDATION: If a query matches multiple products (e.g. 2 blue dresses), politely present all matching items with their names, prices, and stock numbers, and ask the customer which specific one they are interested in!`;

    const userMessage = effectiveUserText || 'Hello';

    // 4. First Turn LLM Generation with Grounding Tools
    const initialLlmResponse = await this.llmProvider.generateResponse(
      [{ role: 'user', content: userMessage }],
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
        const result = await this.toolHandler.executeTool(tenantId, call.name, call.args);
        executedTools.push(result);
      }
    }

    let finalReplyText = initialLlmResponse.text;

    // 6. Second Turn LLM Generation if tools were executed
    if (executedTools.length > 0) {
      const followUpPrompt = `Tool Execution Results: ${JSON.stringify(executedTools)}. Generate a clear, polite response to the user in Banglish/Bangla with exact prices and stock.`;
      const secondLlmResponse = await this.llmProvider.generateResponse(
        [
          { role: 'user', content: userMessage },
          { role: 'assistant', content: `[Executed tools: ${executedTools.map(t => t.toolName).join(', ')}]` },
          { role: 'user', content: followUpPrompt },
        ],
        { systemPrompt, tenantId }
      );
      finalReplyText = secondLlmResponse.text;
    }

    // 7. Post-Generation Response Validator Safety Check
    const validationResult = this.validator.validateReply(finalReplyText, executedTools);

    if (!validationResult.isValid) {
      console.warn(`[AgentOrchestrator] Post-Generation Validator rejected reply: ${validationResult.rejectedReason}`);

      // Fallback rewrite to guaranteed grounded text
      if (executedTools.length > 0) {
        const productsList = (executedTools[0].result as any)?.products;
        const singleProduct = (executedTools[0].result as any)?.product;

        if (productsList && productsList.length > 0) {
          if (productsList.length === 1) {
            const p = productsList[0];
            finalReplyText = `Haa, ${p.titleEn || p.titleBn} ekhon ache. Price ${p.priceBdt} BDT, stock ${p.stockQuantity} pcs. Delivery lagbe ki?`;
          } else {
            const itemsText = productsList.map((p: any, i: number) => `${i + 1}. ${p.titleEn} - Price ${p.priceBdt} BDT (Stock ${p.stockQuantity} pcs)`).join('\n');
            finalReplyText = `Haa, amader kache ${productsList.length} ta item ache:\n${itemsText}\nApni kon ta dekhben?`;
          }
        } else if (singleProduct && singleProduct.priceBdt) {
          finalReplyText = `Haa, ${singleProduct.titleEn || singleProduct.titleBn} ekhon ache. Price ${singleProduct.priceBdt} BDT, stock ${singleProduct.stockQuantity} pcs. Delivery lagbe ki?`;
        } else {
          finalReplyText = `Dukkhto, apnar requested product ti amader current stock e nai. Apni amader baki catalog query korte paren!`;
        }
      } else {
        finalReplyText = `Dukkhto, apnar requested product ti amader current stock e nai. Apni amader baki catalog query korte paren!`;
      }
    }

    // 8. Audit Logging
    await this.auditLogger.logEvent({
      tenantId,
      eventType: 'AI_REPLY_SENT',
      llmPrompt: userMessage,
      llmRawResponse: finalReplyText,
      toolCalls: executedTools.map(t => ({ name: t.toolName, result: t.result })),
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
}
