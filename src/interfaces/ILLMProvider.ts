/**
 * Interface ILLMProvider
 * Abstraction for LLM Operations (Google AI Studio Gemini, Vertex AI, Fallbacks)
 * Ensures infrastructure can be swapped without touching core business logic.
 */

export interface LLMMessageInput {
  role: 'system' | 'user' | 'assistant';
  content: string;
  mediaAttachments?: {
    mimeType: string; // e.g., 'audio/ogg', 'image/jpeg'
    dataBuffer: Buffer;
  }[];
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface LLMToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface LLMResponse {
  text: string;
  toolCalls?: LLMToolCall[];
  rawResponse?: unknown;
  usageTokens?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ILLMProvider {
  /**
   * Generate a response given conversation history, system prompt, and tools.
   */
  generateResponse(
    messages: LLMMessageInput[],
    options?: {
      systemPrompt?: string;
      tools?: LLMToolDefinition[];
      temperature?: number;
      tenantId?: string;
    }
  ): Promise<LLMResponse>;

  /**
   * Transcribe or process raw audio input directly.
   */
  processAudio(
    audioBuffer: Buffer,
    mimeType: string,
    prompt?: string
  ): Promise<{ transcript: string; confidence?: number }>;

  /**
   * Extract features or visual descriptions from image buffer.
   */
  processImage(
    imageBuffer: Buffer,
    mimeType: string,
    prompt?: string
  ): Promise<{ description: string; visualTags: string[] }>;
}
