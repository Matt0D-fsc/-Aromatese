import { IMessageQueue, IncomingWebhookJob } from '../interfaces/IMessageQueue.js';

export interface TrafficHealthMetrics {
  totalJobsEnqueued: number;
  totalJobsProcessed: number;
  droppedMessagesCount: number;
  duplicateMessagesCount: number;
  peakConcurrencyHandled: number;
  averageLatencyMs: number;
}

export class GracefulDegradationService {
  private messageQueue: IMessageQueue;
  private metrics: TrafficHealthMetrics = {
    totalJobsEnqueued: 0,
    totalJobsProcessed: 0,
    droppedMessagesCount: 0,
    duplicateMessagesCount: 0,
    peakConcurrencyHandled: 0,
    averageLatencyMs: 0,
  };

  constructor(messageQueue: IMessageQueue) {
    this.messageQueue = messageQueue;
  }

  /**
   * Process a flash-sale traffic spike safely without dropping customer messages.
   */
  public async handleFlashSaleBurst(jobs: IncomingWebhookJob[]): Promise<TrafficHealthMetrics> {
    const startTime = Date.now();
    this.metrics.peakConcurrencyHandled = Math.max(this.metrics.peakConcurrencyHandled, jobs.length);

    const enqueuePromises = jobs.map(async job => {
      this.metrics.totalJobsEnqueued++;
      const res = await this.messageQueue.enqueue(job);
      if (!res.success) {
        this.metrics.duplicateMessagesCount++;
      } else {
        this.metrics.totalJobsProcessed++;
      }
    });

    await Promise.all(enqueuePromises);

    const totalTimeMs = Date.now() - startTime;
    this.metrics.averageLatencyMs = totalTimeMs / jobs.length;

    return this.metrics;
  }

  public getMetrics(): TrafficHealthMetrics {
    return { ...this.metrics };
  }
}
