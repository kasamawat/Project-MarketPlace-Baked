// src/messaging/mq.events.ts

// พื้นฐานทุก event ฝั่งผู้ซื้อ
export interface BuyerEventBase {
  eventId: string; // ใช้เป็น messageId/idempotency key ได้
  occurredAt: string; // ISO string
  buyerId: string;
  reason?: string;
  masterOrderId: string;
  storeOrderId?: string; // สำหรับอีเวนต์ระดับร้าน
  channelHints?: Array<"in_app" | "email" | "push">;
}

// ---- Orders-level events ----
export interface OrderCreatedEvent extends BuyerEventBase {
  orderNumber: string;
  total: number;
  currency: string;
  paymentMethod: "CARD" | "COD" | "PROMPTPAY";
  expiresAt?: string; // ถ้ามี payment window
}

export interface OrderPaidEvent extends BuyerEventBase {
  total?: number;
  currency?: string;
  paidAt?: string;
  paymentMethod: "CARD" | "COD" | "PROMPTPAY";
  paymentIntentId?: string;
  chargeId?: string;
}

export interface OrderShippedEvent extends BuyerEventBase {
  shipment: {
    shipmentId: string;
    carrier?: string;
    trackingNumber?: string;
    trackingUrl?: string;
    method?: string;
    shippedAt?: string;
    packageIds: string[];
    note?: string;
  };
  items?: Array<{ skuId: string; qty: number; name?: string }>;
}

export interface OrderDeliveredEvent extends BuyerEventBase {
  shipment: {
    shipmentId: string;
    carrier?: string;
    trackingNumber?: string;
    trackingUrl?: string;
    method?: string;
    shippedAt?: string;
    packageIds: string[];
    deliveredAt: string;
    note?: string;
  };
  recipient?: string;
}

// (เลือกใช้ ถ้าจะมีการแจ้งเตือนจาก payment ล้มเหลว/หมดอายุในระดับ order)
export interface OrderPaymentFailedEvent extends BuyerEventBase {
  reason?: string; // e.g. 'declined', 'canceled'
  error?: string; // ข้อความ error สั้น ๆ
  paymentIntentId?: string;
}

export interface OrderPaymentExpiredEvent extends BuyerEventBase {
  expiresAt?: string;
  paymentIntentId?: string;
}

// ---- Type guards แบบเบา ๆ (พอให้ใช้จริงได้) ----
function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

export function isOrderCreatedEvent(x: unknown): x is OrderCreatedEvent {
  return (
    isObj(x) &&
    typeof x.eventId === "string" &&
    typeof x.occurredAt === "string" &&
    typeof x.buyerId === "string" &&
    typeof x.masterOrderId === "string" &&
    typeof x.orderNumber === "string" &&
    typeof x.total !== "undefined" &&
    typeof x.currency === "string"
  );
}

export function isOrderPaidEvent(x: unknown): x is OrderPaidEvent {
  return (
    isObj(x) &&
    typeof x.eventId === "string" &&
    typeof x.occurredAt === "string" &&
    typeof x.buyerId === "string" &&
    typeof x.masterOrderId === "string"
  );
}

export function isOrderShippedEvent(x: unknown): x is OrderShippedEvent {
  const v = x as OrderShippedEvent;
  return (
    !!v &&
    isObj(x) &&
    typeof v.eventId === "string" &&
    typeof v.occurredAt === "string" &&
    typeof v.buyerId === "string" &&
    typeof v.masterOrderId === "string" &&
    typeof v.shipment === "object" &&
    typeof v.shipment.shipmentId === "string" &&
    Array.isArray(v.shipment.packageIds)
  );
}

export function isOrderDeliveredEvent(x: unknown): x is OrderDeliveredEvent {
  const v = x as OrderDeliveredEvent;
  return (
    !!v &&
    isObj(x) &&
    typeof v.eventId === "string" &&
    typeof v.occurredAt === "string" &&
    typeof v.buyerId === "string" &&
    typeof v.masterOrderId === "string" &&
    typeof v.shipment === "object" &&
    typeof v.shipment.shipmentId === "string" &&
    Array.isArray(v.shipment.packageIds)
  );
}

export function isOrderPaymentFailedEvent(
  x: unknown,
): x is OrderPaymentFailedEvent {
  return (
    isObj(x) &&
    typeof x.eventId === "string" &&
    typeof x.occurredAt === "string" &&
    typeof x.buyerId === "string" &&
    typeof x.masterOrderId === "string"
  );
}

export function isOrderPaymentExpiredEvent(
  x: unknown,
): x is OrderPaymentExpiredEvent {
  return (
    isObj(x) &&
    typeof x.eventId === "string" &&
    typeof x.occurredAt === "string" &&
    typeof x.buyerId === "string" &&
    typeof x.masterOrderId === "string"
  );
}
