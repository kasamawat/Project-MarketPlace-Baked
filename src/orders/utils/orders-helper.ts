// utilities (ของคุณน่าจะมีแล้ว): getOrCreateCart, toClient

import { OrderDocument } from "../schemas/order.schema";

export function toClient(order: OrderDocument) {
  return {
    orderId: String(order._id),
    status: order.status, // 'pending_payment' | 'paying' | 'paid' | 'failed' | 'canceled'
    itemsTotal: order.itemsTotal,
    currency: order.currency,
    paidAt: order.paidAt?.toISOString(),
    paidAmount: order.paidAmount,
    paidCurrency: order.paidCurrency,
    failureReason: order.failureReason,
    payment: {
      provider: order.paymentProvider, // 'stripe'
      intentId: order.paymentIntentId, // pi_...
      chargeId: order.chargeId, // ch_...
    },
    reservationExpiresAt: order.reservationExpiresAt?.toISOString(),
  };
}
