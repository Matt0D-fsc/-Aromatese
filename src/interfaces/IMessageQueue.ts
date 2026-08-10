/**
 * Interface IMessageQueue
 * Abstraction for Ingesting and Processing Webhook Message Queues
 * (MVP: Supabase Jobs/In-Memory Queue -> Production: Redis BullMQ / GCP PubSub)
 */

export interface IncomingWebhookJob {
  jobId: string;
  tenantId: string;
  channel: 'whatsapp' | 'messenger' | 'instagram';
  platformMessageId: string;
  senderId: string;
  senderName?: string;
  messageType: 'text' | 'audio' | 'image';
  textContent?: string;
  mediaUrl?: string;
  timestamp: number;
}

export type JobProcessorHandler = (job: IncomingWebhookJob) => Promise<void>;

export interface IMessageQueue {
  /**
   * Push an incoming webhook job into the processing queue.
   */
  enqueue(job: IncomingWebhookJob): Promise<{ success: boolean; jobId: string }>;

  /**
   * Register a worker processor handler to execute queue jobs.
   */
  registerProcessor(handler: JobProcessorHandler): void;

  /**
   * Check if a message has already been processed (Deduplication).
   */
  isDuplicate(tenantId: string, platformMessageId: string): Promise<boolean>;

  /**
   * Mark a message as processed with an expiration TTL.
   */
  markProcessed(tenantId: string, platformMessageId: string, ttlSeconds?: number): Promise<void>;
}
