import { QUEUES } from "../mq.topology";
import {
  PaymentsProcessingPayload,
  PaymentsSucceededPayload,
  PaymentsFailedPayload,
  PaymentsCanceledPayload,
} from "../mq.types";

export function parseAmqpUrls(env?: string | null): string[] | null {
  if (!env) return null;
  const urls = env.includes(",") ? env.split(",").map((s) => s.trim()) : [env];
  return urls.length ? urls : null;
}

// helper เลือกคิว retry ตามรอบ
export function pickRetryQueue(retryCount: number) {
  // ครั้งที่ 0-1 -> 30s, ครั้งที่ 2-4 -> 2m
  return retryCount < 2 ? QUEUES.ORDER_RETRY_30S : QUEUES.ORDER_RETRY_2M;
}

/** ปลอดภัยจาก JSON แตก */
export function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
// payload ของ order.delivered
export function isOrderDeliveredPayload(x: {
  orderId: string;
  userId: string;
  storeId: string;
  deliveredAt: string;
}) {
  return x && typeof x.orderId === "string" && typeof x.userId === "string";
}

/** ดึง masterOrderId จาก payload ที่เป็น object */
export function getMasterOrderIdFromPayload(payload: unknown): string | null {
  if (payload && typeof payload === "object" && "masterOrderId" in payload) {
    const v = payload.masterOrderId;
    return typeof v === "string" && v.trim() ? v : null;
  }
  return null;
}

export function isObj(x: any): x is Record<string, unknown> {
  return x !== null && typeof x === "object";
}

export function isProcessingPayload(
  x: unknown,
): x is PaymentsProcessingPayload {
  return (
    isObj(x) &&
    typeof x.masterOrderId === "string" &&
    typeof x.paymentIntentId === "string"
  );
}

export function isSucceededPayload(x: unknown): x is PaymentsSucceededPayload {
  return (
    isObj(x) &&
    typeof x.masterOrderId === "string" &&
    typeof x.paymentIntentId === "string"
  );
}

export function isCanceledPayload(x: unknown): x is PaymentsCanceledPayload {
  return (
    isObj(x) &&
    typeof x.masterOrderId === "string" &&
    typeof x.paymentIntentId === "string"
  );
}

export function isFailedPayload(x: unknown): x is PaymentsFailedPayload {
  return (
    isObj(x) &&
    typeof x.masterOrderId === "string" &&
    typeof x.paymentIntentId === "string"
  );
}
