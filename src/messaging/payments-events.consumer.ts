/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable @typescript-eslint/require-await */
// payments-events.consumer.ts
import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import type { ConfirmChannel, ConsumeMessage, Options } from "amqplib";
import type {
  AmqpConnectionManager,
  ChannelWrapper,
} from "amqp-connection-manager";

import { MQ_CONNECTION } from "./mq.tokens";
import { bindPaymentsTopology, QUEUES } from "./mq.topology";
import {
  // ปรับ helper ให้รองรับ masterOrderId
  isCanceledPayload,
  isFailedPayload,
  isProcessingPayload,
  isSucceededPayload,
  pickRetryQueue,
  safeJsonParse,
  // 👉 เพิ่ม helper ใหม่ (ดูโน้ตท้ายไฟล์)
  getMasterOrderIdFromPayload,
} from "./helper/mq-helper";
import { SseBus } from "src/realtime/sse.bus";

const MAX_RETRIES = 5;

@Injectable()
export class PaymentsEventsConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentsEventsConsumer.name);
  private channelWrapper: ChannelWrapper | null = null;

  constructor(
    @Inject(MQ_CONNECTION) private readonly conn: AmqpConnectionManager | null,
    private readonly sseBus: SseBus,
  ) {}

  async onModuleInit() {
    if (!this.conn) {
      this.logger.warn("AMQP disabled. Consumer will not start.");
      return;
    }

    this.channelWrapper = this.conn.createChannel({
      setup: async (ch: ConfirmChannel) => {
        await bindPaymentsTopology(ch);
        await ch.prefetch(10);

        await ch.consume(
          QUEUES.ORDER, // ใช้คิวเดิม ถ้าเปลี่ยน topology ค่อยอัปเดตชื่อคิว
          (msg: ConsumeMessage) => this.handleMessage(ch, msg),
          { noAck: false },
        );
      },
    });

    this.logger.log("PaymentsEventsConsumer is ready.");
  }

  private handleMessage = async (ch: ConfirmChannel, msg: ConsumeMessage) => {
    const { routingKey, deliveryTag } = msg.fields;
    const headers = msg.properties.headers ?? {};
    const messageId = String(
      msg.properties.messageId ?? `no-message-id:${deliveryTag}`,
    );
    const contentStr = msg.content.toString("utf-8");
    const retryCount = (headers["x-retries"] as number) ?? 0;

    try {
      const payload = safeJsonParse(contentStr);

      // ✅ รองรับทั้ง masterOrderId และ orderId (legacy)
      const masterOrderId = getMasterOrderIdFromPayload?.(payload) || undefined;

      this.logger.log(
        `Consume ${routingKey} [msgId=${messageId} try=${retryCount}] masterOrderId=${masterOrderId ?? "-"}`,
      );

      if (!masterOrderId) {
        this.logger.warn(
          `Skip message without masterOrderId. routingKey=${routingKey} msgId=${messageId}`,
        );
        ch.ack(msg);
        return;
      }

      switch (true) {
        case routingKey === "payments.processing": {
          if (!isProcessingPayload(payload)) {
            this.logger.warn(
              `Malformed payload for payments.processing: ${contentStr}`,
            );
            ch.ack(msg);
            break;
          }
          // ตัวอย่าง push ให้หน้าชำระเงินโชว์ว่ากำลังประมวลผล
          this.sseBus.push({
            masterOrderId,
            status: "pending_payment",
            paymentIntentId: payload.paymentIntentId,
            at: new Date().toISOString(),
          });
          break;
        }

        case routingKey === "payments.succeeded": {
          if (!isSucceededPayload(payload)) {
            this.logger.warn(
              `Malformed payload for payments.succeeded: ${contentStr}`,
            );
            ch.ack(msg);
            break;
          }

          const paidAmount = payload.paidAmount ?? undefined; // อาจไม่มีจาก publisher
          const paidCurrency = payload.paidCurrency ?? "THB";
          const paymentIntentId = payload.paymentIntentId;
          const chargeId = payload.chargeId;

          this.sseBus.push({
            masterOrderId, // ✅ ใช้ masterOrderId เสมอ
            status: "paid",
            paidAt: new Date().toISOString(),
            paidAmount,
            paidCurrency,
            paymentIntentId,
            chargeId,
          });
          this.sseBus.complete(masterOrderId); // ปิดสตรีมของคำสั่งซื้อนี้
          break;
        }

        case routingKey === "payments.canceled": {
          if (!isCanceledPayload(payload)) {
            this.logger.warn(
              `Malformed payload for payments.canceled: ${contentStr}`,
            );
            ch.ack(msg);
            break;
          }
          const { reason } = payload;
          this.sseBus.push({
            masterOrderId,
            status: "canceled",
            reason: reason ?? "canceled",
          });
          this.sseBus.complete(masterOrderId);
          break;
        }

        case routingKey === "payments.failed": {
          if (!isFailedPayload(payload)) {
            this.logger.warn(
              `Malformed payload for payments.failed: ${contentStr}`,
            );
            ch.ack(msg);
            break;
          }
          // สามารถแจ้งเตือนเฉพาะ admin/ops ที่หน้า backend
          this.sseBus.push({
            masterOrderId,
            status: "failed",
            error: payload.error ?? "payment_failed",
          });
          // ไม่ complete stream เผื่อ user รีลองจ่าย
          break;
        }

        default: {
          this.logger.debug(`Unhandled routingKey: ${routingKey}`);
          break;
        }
      }

      ch.ack(msg);
    } catch (err) {
      this.logger.error(
        `Handler error on ${msg.fields.routingKey} [msgId=${messageId} try=${retryCount}] : ${
          (err as Error)?.message || err
        }`,
      );

      if (retryCount < MAX_RETRIES) {
        const retryQueue = pickRetryQueue(retryCount);
        const publishOpts: Options.Publish = {
          persistent: true,
          contentType: "application/json",
          messageId, // คง messageId เดิม เพื่อช่วย idempotency
          headers: { ...headers, "x-retries": retryCount + 1 },
        };
        ch.sendToQueue(retryQueue, msg.content, publishOpts);
        ch.ack(msg);
      } else {
        ch.nack(msg, false, false); // DLQ
      }
    }
  };

  async onModuleDestroy() {
    try {
      await this.channelWrapper?.close();
      this.logger.log("PaymentsEventsConsumer channel closed.");
    } catch {
      // ignore
    }
  }
}
