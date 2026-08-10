export type IdempotencyScope = 'message_ingestion' | 'order_creation';

export interface IdempotencyRecord {
  idempotencyKey: string;
  tenantId: string;
  scope: IdempotencyScope;
  responsePayload?: unknown;
  createdAt: Date;
  expiresAt: Date;
}

export interface IdempotencyStore {
  getRecord(tenantId: string, scope: IdempotencyScope, key: string): Promise<IdempotencyRecord | null>;
  saveRecord(record: IdempotencyRecord): Promise<void>;
}

export class IdempotencyManager {
  private store: IdempotencyStore;

  constructor(store: IdempotencyStore) {
    this.store = store;
  }

  /**
   * Execute an operation idempotently.
   * If key exists within scope, returns stored result without re-executing.
   */
  public async executeIdempotent<T>(
    tenantId: string,
    scope: IdempotencyScope,
    idempotencyKey: string,
    operation: () => Promise<T>,
    ttlSeconds: number = 86400 // 24 hours default
  ): Promise<{ result: T; wasCached: boolean }> {
    const existing = await this.store.getRecord(tenantId, scope, idempotencyKey);

    if (existing && new Date() < new Date(existing.expiresAt)) {
      return {
        result: existing.responsePayload as T,
        wasCached: true,
      };
    }

    const result = await operation();

    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + ttlSeconds);

    await this.store.saveRecord({
      tenantId,
      scope,
      idempotencyKey,
      responsePayload: result,
      createdAt: new Date(),
      expiresAt,
    });

    return {
      result,
      wasCached: false,
    };
  }
}
