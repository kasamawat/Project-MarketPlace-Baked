// mq.topology.ts
import type { ConfirmChannel } from "amqplib";

export const EXCHANGES = {
  PAYMENTS_EVENTS: "payments.events", // topic exchange หลัก
  ORDERS_EVENTS: "orders.events", // order exchange
  DLX: "payments.dlx", // dead-letter exchange (topic/direct ก็ได้)
  AE: "payments.unrouted", // alternate exchange สำหรับ unroutable
} as const;

export const QUEUES = {
  ORDER: "payments.order",
  ORDER_RETRY_30S: "payments.order.retry.30s",
  ORDER_RETRY_2M: "payments.order.retry.2m",
  ORDER_DLQ: "payments.order.dlq",
  UNROUTED: "payments.unrouted", // คิวเก็บข้อความที่ไม่ถูก route
  // options queue for downstream
  NOTIFY_SUCCEEDED: "payments.notify.succeeded",
  NOTIFY_CANCELED: "payments.notify.canceled",
  NOTIFY_PROCESSING: "payments.notify.processing",
  ORDER_NOTIFY: "orders.notify",
} as const;

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
  await ch.assertQueue(QUEUES.ORDER_NOTIFY, { durable: true });
  await ch.bindQueue(QUEUES.ORDER_NOTIFY, EXCHANGES.ORDERS_EVENTS, "orders.*");
}
