import { IMessageQueue, IncomingWebhookJob, JobProcessorHandler } from '../interfaces/IMessageQueue.js';

export class MessageQueue implements IMessageQueue {
  private queue: IncomingWebhookJob[] = [];
  private processedMap: Map<string, number> = new Map(); // Key: `${tenantId}:${platformMessageId}` -> expiry timestamp
  private processor?: JobProcessorHandler;
  private isProcessing: boolean = false;

  /**
   * Enqueue job with sub-50ms HTTP acknowledgment.
   */
  public async enqueue(job: IncomingWebhookJob): Promise<{ success: boolean; jobId: string }> {
    const startTime = Date.now();
    const isDup = await this.isDuplicate(job.tenantId, job.platformMessageId);

    if (isDup) {
      return { success: false, jobId: job.jobId };
    }

    this.queue.push(job);
    await this.markProcessed(job.tenantId, job.platformMessageId, 86400); // 24hr TTL

    // Trigger async processing non-blocking
    setImmediate(() => this.processNext());

    const duration = Date.now() - startTime;
    if (duration > 50) {
      console.warn(`[MessageQueue] Enqueue took ${duration}ms (Target: <50ms)`);
    }

    return { success: true, jobId: job.jobId };
  }

  public registerProcessor(handler: JobProcessorHandler): void {
    this.processor = handler;
  }

  public async isDuplicate(tenantId: string, platformMessageId: string): Promise<boolean> {
    const key = `${tenantId}:${platformMessageId}`;
    const expiry = this.processedMap.get(key);
    if (!expiry) return false;

    if (Date.now() > expiry) {
      this.processedMap.delete(key);
      return false;
    }
    return true;
  }

  public async markProcessed(tenantId: string, platformMessageId: string, ttlSeconds: number = 86400): Promise<void> {
    const key = `${tenantId}:${platformMessageId}`;
    const expiry = Date.now() + ttlSeconds * 1000;
    this.processedMap.set(key, expiry);
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0 || !this.processor) {
      return;
    }

    this.isProcessing = true;
    const job = this.queue.shift();

    if (job) {
      try {
        await this.processor(job);
      } catch (err) {
        console.error(`[MessageQueue] Error processing job ${job.jobId}:`, err);
      }
    }

    this.isProcessing = false;

    if (this.queue.length > 0) {
      setImmediate(() => this.processNext());
    }
  }
}
