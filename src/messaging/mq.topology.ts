// mq.topology.ts
import type { ConfirmChannel, Options } from "amqplib";

export const EXCHANGES = {
  PAYMENTS_EVENTS: "payments.events",
  ORDERS_EVENTS: "orders.events",
  DLX: "payments.dlx",
  AE: "payments.unrouted",

  // --- NEW for Notification ---
  NOTIF_EVENTS: "notif.events",
  NOTIF_DLX: "notif.dlx",
  NOTIF_AE: "notif.unrouted",
} as const;

export const QUEUES = {
  ORDER: "payments.order",
  ORDER_RETRY_30S: "payments.order.retry.30s",
  ORDER_RETRY_2M: "payments.order.retry.2m",
  ORDER_DLQ: "payments.order.dlq",
  UNROUTED: "payments.unrouted",
  NOTIFY_SUCCEEDED: "payments.notify.succeeded",
  NOTIFY_CANCELED: "payments.notify.canceled",
  NOTIFY_PROCESSING: "payments.notify.processing",
  // ORDER_NOTIFY: "orders.notify",

  // --- NEW for Notification ---
  NOTIF_MAIN: "notif.main",
  NOTIF_RETRY_30S: "notif.retry.30s",
  NOTIF_RETRY_2M: "notif.retry.2m",
  NOTIF_DLQ: "notif.dlq",
  NOTIF_UNROUTED: "notif.unrouted",
} as const;

// ==== (เดิม) bindPaymentsTopology คงไว้ตามที่มี ====
export async function bindPaymentsTopology(ch: ConfirmChannel): Promise<void> {
  // 1) Exchanges
  await ch.assertExchange(EXCHANGES.DLX, "topic", { durable: true });
  await ch.assertExchange(EXCHANGES.AE, "fanout", { durable: true }); // สำหรับข้อความที่ไม่ถูก route
  await ch.assertExchange(EXCHANGES.PAYMENTS_EVENTS, "topic", {
    durable: true,
    arguments: {
      "alternate-exchange": EXCHANGES.AE,
    },
  });
  await ch.assertExchange(EXCHANGES.ORDERS_EVENTS, "topic", {
    durable: true,
  });

  // 2) Unrouted sink
  await ch.assertQueue(QUEUES.UNROUTED, { durable: true });
  await ch.bindQueue(QUEUES.UNROUTED, EXCHANGES.AE, "");

  // 3) DLQ
  await ch.assertQueue(QUEUES.ORDER_DLQ, {
    durable: true,
    arguments: {
      "x-queue-mode": "default",
    },
  });
  // ผูก DLQ กับ DLX (รับทุก routing key ที่เด้งมา)
  await ch.bindQueue(QUEUES.ORDER_DLQ, EXCHANGES.DLX, "#");

  // 4) MAIN queue (dead-letter -> DLX)
  await ch.assertQueue(QUEUES.ORDER, {
    durable: true,
    arguments: {
      "x-dead-letter-exchange": EXCHANGES.DLX,
      "x-queue-mode": "default",
    },
  });
  await ch.bindQueue(QUEUES.ORDER, EXCHANGES.PAYMENTS_EVENTS, "payments.*");

  // (optional) คิวเฉพาะ
  await ch.assertQueue(QUEUES.NOTIFY_SUCCEEDED, { durable: true });
  await ch.assertQueue(QUEUES.NOTIFY_CANCELED, { durable: true });
  await ch.assertQueue(QUEUES.NOTIFY_PROCESSING, { durable: true });

  await ch.bindQueue(
    QUEUES.NOTIFY_SUCCEEDED,
    EXCHANGES.PAYMENTS_EVENTS,
    "payments.succeeded",
  );
  await ch.bindQueue(
    QUEUES.NOTIFY_CANCELED,
    EXCHANGES.PAYMENTS_EVENTS,
    "payments.canceled",
  );
  await ch.bindQueue(
    QUEUES.NOTIFY_PROCESSING,
    EXCHANGES.PAYMENTS_EVENTS,
    "payments.processing",
  );

  // 5) RETRY queues (TTL -> dead-letter กลับ MAIN)
  await ch.assertQueue(QUEUES.ORDER_RETRY_30S, {
    durable: true,
    arguments: {
      "x-dead-letter-exchange": "", // ใช้ default exchange
      "x-dead-letter-routing-key": QUEUES.ORDER, // ส่งกลับ MAIN
      "x-message-ttl": 30_000,
    },
  });

  await ch.assertQueue(QUEUES.ORDER_RETRY_2M, {
    durable: true,
    arguments: {
      "x-dead-letter-exchange": "",
      "x-dead-letter-routing-key": QUEUES.ORDER,
      "x-message-ttl": 120_000,
    },
  });

  // queue ตัวอย่างสำหรับ order events
  // await ch.assertQueue(QUEUES.ORDER_NOTIFY, { durable: true });
  // await ch.bindQueue(QUEUES.ORDER_NOTIFY, EXCHANGES.ORDERS_EVENTS, "orders.*");
}

// ==== (ใหม่) topology สำหรับ notification ====
export async function bindNotificationTopology(
  ch: ConfirmChannel,
): Promise<void> {
  // Exchanges
  await ch.assertExchange(EXCHANGES.NOTIF_DLX, "topic", { durable: true });
  await ch.assertExchange(EXCHANGES.NOTIF_AE, "fanout", { durable: true });
  await ch.assertExchange(EXCHANGES.NOTIF_EVENTS, "topic", {
    durable: true,
    arguments: { "alternate-exchange": EXCHANGES.NOTIF_AE },
  });

  // Unrouted sink for notif.*
  await ch.assertQueue(QUEUES.NOTIF_UNROUTED, { durable: true });
  await ch.bindQueue(QUEUES.NOTIF_UNROUTED, EXCHANGES.NOTIF_AE, "");

  // DLQ
  await ch.assertQueue(QUEUES.NOTIF_DLQ, {
    durable: true,
    arguments: { "x-queue-mode": "default" },
  });
  await ch.bindQueue(QUEUES.NOTIF_DLQ, EXCHANGES.NOTIF_DLX, "#");

  // Main queue (dead-letter -> NOTIF_DLX)
  await ch.assertQueue(QUEUES.NOTIF_MAIN, {
    durable: true,
    arguments: {
      "x-dead-letter-exchange": EXCHANGES.NOTIF_DLX,
      "x-queue-mode": "default",
    },
  });
  // กินทุก key ที่วิ่งเข้ามาใน notif.events
  await ch.bindQueue(QUEUES.NOTIF_MAIN, EXCHANGES.NOTIF_EVENTS, "#");

  // Retry queues (TTL -> เด้งกลับคิวหลัก)
  await ch.assertQueue(QUEUES.NOTIF_RETRY_30S, {
    durable: true,
    arguments: {
      "x-dead-letter-exchange": "",
      "x-dead-letter-routing-key": QUEUES.NOTIF_MAIN,
      "x-message-ttl": 30_000,
    },
  });
  await ch.assertQueue(QUEUES.NOTIF_RETRY_2M, {
    durable: true,
    arguments: {
      "x-dead-letter-exchange": "",
      "x-dead-letter-routing-key": QUEUES.NOTIF_MAIN,
      "x-message-ttl": 120_000,
    },
  });

  // --- Exchange-to-Exchange bindings ---
  // จาก orders.events → notif.events
  await ch.bindExchange(
    EXCHANGES.NOTIF_EVENTS,
    EXCHANGES.ORDERS_EVENTS,
    "orders.created",
  );
  await ch.bindExchange(
    EXCHANGES.NOTIF_EVENTS,
    EXCHANGES.ORDERS_EVENTS,
    "orders.paid",
  );
  await ch.bindExchange(
    EXCHANGES.NOTIF_EVENTS,
    EXCHANGES.ORDERS_EVENTS,
    "orders.shipped",
  );
  await ch.bindExchange(
    EXCHANGES.NOTIF_EVENTS,
    EXCHANGES.ORDERS_EVENTS,
    "orders.delivered",
  );
  await ch.bindExchange(
    EXCHANGES.NOTIF_EVENTS,
    EXCHANGES.ORDERS_EVENTS,
    "orders.payment_expired",
  );
  // เพิ่ม key อื่น ๆ ได้ตามต้องการ เช่น 'orders.partially_shipped' ฯลฯ
}

export const SEARCH_EXCHANGE = "search"; // topic exchange เดียว
export const SEARCH_DLX = `${SEARCH_EXCHANGE}.dlx`;

export const SEARCH_QUEUES = {
  MAIN: "search.indexer",
  RETRY_30S: "search.indexer.retry.30s",
  RETRY_2M: "search.indexer.retry.2m",
  DLQ: "search.indexer.dlq",
} as const;

export const SEARCH_RK = {
  INDEX_PRODUCT: "search.index.product",
  DELETE_PRODUCT: "search.delete.product",
  INDEX_STORE: "search.index.store",
  DELETE_STORE: "search.delete.store",
} as const;

export async function bindSearchTopology(ch: ConfirmChannel) {
  // Exchanges
  await ch.assertExchange(SEARCH_EXCHANGE, "topic", { durable: true });
  await ch.assertExchange(SEARCH_DLX, "fanout", { durable: true });

  // Main queue
  await ch.assertQueue(SEARCH_QUEUES.MAIN, {
    durable: true,
    deadLetterExchange: SEARCH_DLX,
  });

  // Retry queues (ใช้ x-message-ttl + dead-letter ไป MAIN)
  await ch.assertQueue(SEARCH_QUEUES.RETRY_30S, {
    durable: true,
    deadLetterExchange: SEARCH_EXCHANGE,
    deadLetterRoutingKey: SEARCH_RK.INDEX_PRODUCT, // กลับเข้า main ผ่าน RK นี้ (แต่เราจะ publish ด้วย RK เดิมอยู่แล้วก็ได้)
    messageTtl: 30_000,
  });
  await ch.assertQueue(SEARCH_QUEUES.RETRY_2M, {
    durable: true,
    deadLetterExchange: SEARCH_EXCHANGE,
    deadLetterRoutingKey: SEARCH_RK.INDEX_PRODUCT,
    messageTtl: 120_000,
  });

  // DLQ
  await ch.assertQueue(SEARCH_QUEUES.DLQ, { durable: true });
  await ch.bindQueue(SEARCH_QUEUES.DLQ, SEARCH_DLX, "");

  // Bind main queue กับ routing keys ที่รองรับ
  await ch.bindQueue(
    SEARCH_QUEUES.MAIN,
    SEARCH_EXCHANGE,
    SEARCH_RK.INDEX_PRODUCT,
  );
  await ch.bindQueue(
    SEARCH_QUEUES.MAIN,
    SEARCH_EXCHANGE,
    SEARCH_RK.DELETE_PRODUCT,
  );
  await ch.bindQueue(
    SEARCH_QUEUES.MAIN,
    SEARCH_EXCHANGE,
    SEARCH_RK.INDEX_STORE,
  );
  await ch.bindQueue(
    SEARCH_QUEUES.MAIN,
    SEARCH_EXCHANGE,
    SEARCH_RK.DELETE_STORE,
  );
}

// helper เลือก retry queue
export function pickSearchRetryQueue(tryCount: number): string {
  return tryCount < 3 ? SEARCH_QUEUES.RETRY_30S : SEARCH_QUEUES.RETRY_2M;
}

// publish options ที่คงรูปแบบเดียวกับตัวอื่นในระบบคุณ
export function basePublishOpts(
  messageId: string,
  headers: Record<string, any> = {},
): Options.Publish {
  return {
    persistent: true,
    contentType: "application/json",
    messageId,
    headers,
    timestamp: Date.now(),
  };
}
