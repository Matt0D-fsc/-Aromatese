import { IdempotencyManager } from './IdempotencyManager.js';
import { AddressParserBD, ParsedBDAddress } from './AddressParserBD.js';

export interface OrderItemPayload {
  productId: string;
  sku: string;
  name: string;
  priceBdt: number;
  quantity: number;
}

export interface CreateOrderRequest {
  tenantId: string;
  customerId: string;
  conversationId?: string;
  idempotencyKey: string;
  recipientName: string;
  recipientPhone: string;
  deliveryAddress: string;
  paymentMethod: 'cod' | 'bkash' | 'nagad';
  items: OrderItemPayload[];
}

export interface DraftOrderResponse {
  orderId: string;
  orderNumber: string;
  tenantId: string;
  status: 'draft' | 'confirmed';
  subtotalBdt: number;
  courierFeeBdt: number;
  totalBdt: number;
  shippingAddress: ParsedBDAddress;
  paymentMethod: 'cod' | 'bkash' | 'nagad';
  paymentInstructions: string;
  stockReservationExpiresAt: Date;
  wasCached: boolean;
}

export class OrderService {
  private idempotencyManager: IdempotencyManager;
  private ordersDb: Map<string, any> = new Map(); // Composite Key: `${tenantId}:${orderId}`
  private orderCounter: number = 1000;

  constructor(idempotencyManager: IdempotencyManager) {
    this.idempotencyManager = idempotencyManager;
  }

  /**
   * Create a draft order with idempotency protection, 15-minute stock lock, and courier calculation.
   */
  public async createDraftOrder(req: CreateOrderRequest): Promise<DraftOrderResponse> {
    const { tenantId, idempotencyKey, recipientPhone, deliveryAddress, paymentMethod, items } = req;

    return (
      await this.idempotencyManager.executeIdempotent(
        tenantId,
        'order_creation',
        idempotencyKey,
        async () => {
          const parsedAddress = AddressParserBD.parseAddress(deliveryAddress, recipientPhone);

          if (!parsedAddress.isValidPhone) {
            throw new Error('INVALID_BD_PHONE: Phone number must be a valid 11-digit Bangladeshi mobile number (013-019).');
          }

          const subtotalBdt = items.reduce((acc, item) => acc + item.priceBdt * item.quantity, 0);
          const courierFeeBdt = parsedAddress.courierFeeBdt;
          const totalBdt = subtotalBdt + courierFeeBdt;

          this.orderCounter++;
          const orderId = `ord_${Date.now()}_${this.orderCounter}`;
          const orderNumber = `MATTIC-BD-${this.orderCounter}`;

          const reservationExpiresAt = new Date();
          reservationExpiresAt.setMinutes(reservationExpiresAt.getMinutes() + 15); // 15-minute stock lock

          let paymentInstructions = '';
          if (paymentMethod === 'cod') {
            paymentInstructions = `Cash on Delivery (COD) selected. Total BDT ${totalBdt} will be collected upon delivery by courier officer.`;
          } else if (paymentMethod === 'bkash') {
            paymentInstructions = `bKash Merchant Pay selected. Send total BDT ${totalBdt} to bKash Merchant Number: 01700000000 (Reference: ${orderNumber}).`;
          } else if (paymentMethod === 'nagad') {
            paymentInstructions = `Nagad Merchant Pay selected. Send total BDT ${totalBdt} to Nagad Merchant Number: 01800000000 (Reference: ${orderNumber}).`;
          }

          const orderRecord = {
            orderId,
            orderNumber,
            tenantId,
            status: 'draft' as const,
            subtotalBdt,
            courierFeeBdt,
            totalBdt,
            shippingAddress: parsedAddress,
            paymentMethod,
            paymentInstructions,
            stockReservationExpiresAt: reservationExpiresAt,
            wasCached: false,
          };

          this.ordersDb.set(`${tenantId}:${orderId}`, orderRecord);

          return orderRecord;
        }
      )
    ).result;
  }
}
