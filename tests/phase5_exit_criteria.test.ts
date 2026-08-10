import { describe, it, expect, beforeEach } from 'vitest';
import { AddressParserBD } from '../src/services/AddressParserBD.js';
import { OrderService, CreateOrderRequest } from '../src/services/OrderService.js';
import { IdempotencyManager, IdempotencyStore, IdempotencyRecord, IdempotencyScope } from '../src/services/IdempotencyManager.js';

class MockIdempotencyStore implements IdempotencyStore {
  private records: Map<string, IdempotencyRecord> = new Map();

  async getRecord(tenantId: string, scope: IdempotencyScope, key: string): Promise<IdempotencyRecord | null> {
    return this.records.get(`${tenantId}:${scope}:${key}`) || null;
  }

  async saveRecord(record: IdempotencyRecord): Promise<void> {
    this.records.set(`${record.tenantId}:${record.scope}:${record.idempotencyKey}`, record);
  }
}

describe('PHASE 5: Order Creation & Bangladesh Logistics/Payment Exit Criteria Validation', () => {
  let orderService: OrderService;
  let idempotencyStore: MockIdempotencyStore;
  let idempotencyManager: IdempotencyManager;

  const TENANT_ID = 'tenant-order-bd-001';

  beforeEach(() => {
    idempotencyStore = new MockIdempotencyStore();
    idempotencyManager = new IdempotencyManager(idempotencyStore);
    orderService = new OrderService(idempotencyManager);
  });

  it('EXIT CRITERION 1: BD Phone Validation & Courier Fee Breakdown (Inside vs Outside Dhaka)', () => {
    // Valid BD Mobile numbers (013 - 019)
    expect(AddressParserBD.validateBDPhone('01712345678').isValid).toBe(true);
    expect(AddressParserBD.validateBDPhone('+8801812345678').isValid).toBe(true);
    expect(AddressParserBD.validateBDPhone('01912345678').isValid).toBe(true);
    // Invalid numbers
    expect(AddressParserBD.validateBDPhone('01212345678').isValid).toBe(false); // Invalid prefix 012
    expect(AddressParserBD.validateBDPhone('12345').isValid).toBe(false);

    // Inside Dhaka calculation
    const insideDhaka = AddressParserBD.parseAddress('Mirpur 10, Dhaka', '01712345678');
    expect(insideDhaka.isInsideDhaka).toBe(true);
    expect(insideDhaka.courierFeeBdt).toBe(70);

    // Outside Dhaka calculation
    const outsideDhaka = AddressParserBD.parseAddress('Chittagong GEC Circle', '01812345678');
    expect(outsideDhaka.isInsideDhaka).toBe(false);
    expect(outsideDhaka.courierFeeBdt).toBe(130);
  });

  it('EXIT CRITERION 2: Duplicate Order Submission Protection — Idempotency key prevents double-ordering', async () => {
    const orderReq: CreateOrderRequest = {
      tenantId: TENANT_ID,
      customerId: 'cust-101',
      idempotencyKey: 'checkout_idemp_key_999',
      recipientName: 'Tanvir Hossain',
      recipientPhone: '01711223344',
      deliveryAddress: 'Dhanmondi 32, Dhaka',
      paymentMethod: 'cod',
      items: [
        { productId: 'p1', sku: 'PUNJABI-01', name: 'Cotton Panjabi', priceBdt: 1800, quantity: 1 },
      ],
    };

    // First order creation
    const order1 = await orderService.createDraftOrder(orderReq);
    expect(order1.orderNumber).toBeTruthy();
    expect(order1.subtotalBdt).toBe(1800);
    expect(order1.courierFeeBdt).toBe(70); // Inside Dhaka
    expect(order1.totalBdt).toBe(1870); // 1800 + 70 = 1870 BDT

    // Second order creation (Simulated double-tap or network retry)
    const order2 = await orderService.createDraftOrder(orderReq);
    expect(order2.orderNumber).toBe(order1.orderNumber);
    expect(order2.totalBdt).toBe(1870);
  });
});
