import crypto from 'crypto';
import { IncomingWebhookJob } from '../interfaces/IMessageQueue.js';

export interface MetaWebhookPayload {
  object: 'whatsapp_business_account' | 'page' | 'instagram';
  entry: Array<{
    id: string;
    messaging?: Array<{
      sender: { id: string };
      recipient: { id: string };
      timestamp: number;
      message?: {
        mid: string;
        text?: string;
        attachments?: Array<{ type: string; payload: { url?: string } }>;
      };
    }>;
    changes?: Array<{
      value: {
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          type: 'text' | 'audio' | 'image';
          text?: { body: string };
          audio?: { id: string; mime_type: string };
          image?: { id: string; mime_type: string; sha256?: string };
        }>;
        contacts?: Array<{ profile: { name: string } }>;
      };
    }>;
  }>;
}

export class MetaWebhookGateway {
  /**
   * Verify HMAC SHA-256 signature from Meta webhook headers (`X-Hub-Signature-256`).
   */
  public verifySignature(rawBody: string, signatureHeader: string | undefined, appSecret: string): boolean {
    if (!signatureHeader || !appSecret) return false;

    const parts = signatureHeader.split('=');
    if (parts.length !== 2 || parts[0] !== 'sha256') return false;

    const expectedHash = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

    return crypto.timingSafeEqual(Buffer.from(parts[1], 'hex'), Buffer.from(expectedHash, 'hex'));
  }

  /**
   * Parse Meta Webhook Payload into normalized IncomingWebhookJobs.
   */
  public parseWebhookPayload(tenantId: string, payload: MetaWebhookPayload): IncomingWebhookJob[] {
    const jobs: IncomingWebhookJob[] = [];

    if (!payload.entry || !Array.isArray(payload.entry)) return jobs;

    for (const entry of payload.entry) {
      // 1. WhatsApp Business API Webhooks
      if (payload.object === 'whatsapp_business_account' && entry.changes) {
        for (const change of entry.changes) {
          const value = change.value;
          if (value.messages) {
            const senderName = value.contacts?.[0]?.profile?.name;

            for (const msg of value.messages) {
              let msgType: 'text' | 'audio' | 'image' = 'text';
              let textContent: string | undefined;
              let mediaUrl: string | undefined;

              if (msg.type === 'text' && msg.text) {
                msgType = 'text';
                textContent = msg.text.body;
              } else if (msg.type === 'audio') {
                msgType = 'audio';
                mediaUrl = msg.audio?.id;
              } else if (msg.type === 'image') {
                msgType = 'image';
                mediaUrl = msg.image?.id;
              }

              jobs.push({
                jobId: `job_wa_${msg.id}_${Date.now()}`,
                tenantId,
                channel: 'whatsapp',
                platformMessageId: msg.id,
                senderId: msg.from,
                senderName,
                messageType: msgType,
                textContent,
                mediaUrl,
                timestamp: parseInt(msg.timestamp, 10) * 1000 || Date.now(),
              });
            }
          }
        }
      }

      // 2. Facebook Messenger / Instagram DM Webhooks
      if ((payload.object === 'page' || payload.object === 'instagram') && entry.messaging) {
        const channel = payload.object === 'instagram' ? 'instagram' : 'messenger';

        for (const item of entry.messaging) {
          if (!item.message) continue;

          let msgType: 'text' | 'audio' | 'image' = 'text';
          let textContent = item.message.text;
          let mediaUrl: string | undefined;

          if (item.message.attachments && item.message.attachments.length > 0) {
            const att = item.message.attachments[0];
            if (att.type === 'audio') {
              msgType = 'audio';
              mediaUrl = att.payload.url;
            } else if (att.type === 'image') {
              msgType = 'image';
              mediaUrl = att.payload.url;
            }
          }

          jobs.push({
            jobId: `job_${channel}_${item.message.mid}_${Date.now()}`,
            tenantId,
            channel,
            platformMessageId: item.message.mid,
            senderId: item.sender.id,
            messageType: msgType,
            textContent,
            mediaUrl,
            timestamp: item.timestamp || Date.now(),
          });
        }
      }
    }

    return jobs;
  }
}
