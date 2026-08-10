export interface AuditLogEntry {
  tenantId: string;
  conversationId?: string;
  messageId?: string;
  eventType: string; // e.g. 'AI_RESPONSE_GENERATED', 'TOOL_CALLED', 'RESPONSE_VALIDATED', 'ORDER_CREATED'
  llmPrompt?: string;
  llmRawResponse?: string;
  toolCalls?: Record<string, unknown>[];
  groundingProof?: Record<string, unknown>;
  createdAt?: Date;
}

export interface AuditLogStore {
  insertLog(entry: AuditLogEntry): Promise<void>;
}

export class AuditLogger {
  private store: AuditLogStore;

  constructor(store: AuditLogStore) {
    this.store = store;
  }

  /**
   * Log an AI decision, tool call, or grounded response for dispute resolution and compliance.
   */
  public async logEvent(entry: AuditLogEntry): Promise<void> {
    const payload: AuditLogEntry = {
      ...entry,
      createdAt: entry.createdAt || new Date(),
    };
    await this.store.insertLog(payload);
  }
}
