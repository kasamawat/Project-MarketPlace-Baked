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
  getOrderIdFromPayload,
  isFailedPayload,
  isProcessingPayload,
  isSucceededPayload,
  pickRetryQueue,
  safeJsonParse,
} from "./helper/mq-helper";
import { SseBus } from "src/realtime/sse.bus";

// options set max retry
const MAX_RETRIES = 5;

@Injectable()
export class PaymentsEventsConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentsEventsConsumer.name);
  private channelWrapper: ChannelWrapper | null = null;

  constructor(
    @Inject(MQ_CONNECTION) private readonly conn: AmqpConnectionManager | null,
    private readonly sseBus: SseBus,
  ) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async onModuleInit() {
    if (!this.conn) {
      this.logger.warn("AMQP disabled. Consumer will not start.");
      return;
    }

    // ใช้ ChannelWrapper ของ amqp-connection-manager (มี auto-reconnect)
    this.channelWrapper = this.conn.createChannel({
      setup: async (ch: ConfirmChannel) => {
        // 1) สร้าง/ผูก Exchange/Queue/Binding (ควรมี retry & DLQ ใน topology)
        await bindPaymentsTopology(ch);

        // 2) จำกัดงานค้างต่อ consumer
        await ch.prefetch(10);

        // 3) เริ่ม consume
        await ch.consume(
          QUEUES.ORDER,
          // eslint-disable-next-line @typescript-eslint/no-misused-promises
          (msg: ConsumeMessage) => this.handleMessage(ch, msg),
          { noAck: false },
        );
      },
    });

    this.logger.log("PaymentsEventsConsumer is ready.");
  }

  /**
   * ตัวประมวลผลข้อความจากคิว
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  private handleMessage = async (ch: ConfirmChannel, msg: ConsumeMessage) => {
    // const routingKey = msg.fields.routingKey;
    // const deliveryTag = msg.fields.deliveryTag;
    const { routingKey, deliveryTag } = msg.fields;
    const headers = msg.properties.headers ?? {};
    const messageId = String(
      msg.properties.messageId ?? `no-message-id:${deliveryTag}`,
    );
    const contentStr = msg.content.toString("utf-8");
    const retryCount = (headers["x-retries"] as number) ?? 0;

    try {
      // change payload to JSON
      const payload = safeJsonParse(contentStr);
      // (option) check pattern
      const orderId = getOrderIdFromPayload(payload);

      this.logger.log(
        `Consume ${routingKey} [msgId=${messageId} try=${retryCount}] orderId=${orderId}`,
      );

      // ถ้าไม่มี orderId ไม่ต้องพยายามต่อ (กัน type error + ขยะ)
      if (!orderId) {
        this.logger.warn(
          `Skip message without orderId. routingKey=${routingKey} msgId=${messageId}`,
        );
        ch.ack(msg);
        return;
      }

      // TODO: ใส่ business logic ที่นี่
      switch (true) {
        case routingKey === "payments.processing": {
          if (!isProcessingPayload(payload)) {
            this.logger.warn(
              `Malformed payload for payments.processing: ${contentStr}`,
            );
            ch.ack(msg);
            break;
          }
          // TODO: update read model / notify
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
          const { paymentIntentId, chargeId, paidAmount, paidCurrency } =
            payload;

          this.sseBus.push({
            orderId, // ✅ ตอนนี้เป็น string แน่นอน
            status: "paid",
            paidAt: new Date().toISOString(),
            paidAmount: paidAmount ?? undefined,
            paidCurrency: paidCurrency ?? "THB",
            paymentIntentId,
            chargeId,
          });
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
          // TODO: บันทึกเหตุผล, แจ้งทีมซัพพอร์ต ฯลฯ
          break;
        }
        default: {
          // routingKey อื่นที่ยังไม่รองรับ
          this.logger.debug(`Unhandled routingKey: ${routingKey}`);
          break;
        }
      }

      ch.ack(msg); // สำเร็จ
    } catch (err) {
      this.logger.error(
        `Handler error on ${routingKey} [msgId=${messageId} try=${retryCount}] : ${
          (err as Error)?.message || err
        }`,
      );

      // รวมทั้งหมดให้ retry ได้ MAX_RETRIES ครั้ง (0..4) แล้วค่อย DLQ
      if (retryCount < MAX_RETRIES) {
        const retryQueue = pickRetryQueue(retryCount);
        const publishOpts: Options.Publish = {
          persistent: true,
          contentType: "application/json",
          messageId, // คง messageId เดิม เพื่อช่วย idempotency
          headers: { ...headers, "x-retries": retryCount + 1 },
        };
        ch.sendToQueue(retryQueue, msg.content, publishOpts);
        ch.ack(msg); // ack ต้นฉบับ เพราะเราโยนไปคิว retry แล้ว
      } else {
        // ครบโควต้าแล้ว -> ปล่อยให้ไป DLQ (ต้องตั้ง DLX ที่คิวหลักไว้)
        ch.nack(msg, false, false); // requeue=false => dead-letter ไป DLQ
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
