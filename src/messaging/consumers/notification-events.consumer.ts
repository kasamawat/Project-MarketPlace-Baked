/* eslint-disable @typescript-eslint/no-misused-promises */
import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { ConfirmChannel, ConsumeMessage, Options } from "amqplib";
import type {
  AmqpConnectionManager,
  ChannelWrapper,
} from "amqp-connection-manager";
import { MQ_CONNECTION } from "../mq.tokens";
import { bindNotificationTopology, QUEUES } from "../mq.topology";
import { safeJsonParse } from "../helper/mq-helper";
// ⛔ เปลี่ยนมาใช้ retry queue ของ notification เอง แทน pickRetryQueue ของ payments
// import { pickRetryQueue } from "../helper/mq-helper";
import { NotificationService } from "../../notification/notification.service";
import {
  isOrderCreatedEvent,
  isOrderPaidEvent,
  isOrderShippedEvent,
  isOrderDeliveredEvent,
  isOrderPaymentFailedEvent,
  isOrderPaymentExpiredEvent,
} from "../mq.events";

const MAX_RETRIES = 5;

// เลือกคิว retry สำหรับ notification โดยเฉพาะ
function pickNotifRetryQueue(tryCount: number): string {
  // ตัวอย่างนโยบาย: รอบแรกๆ รอ 30s, หลังจากนั้นรอ 2m
  return tryCount < 3 ? QUEUES.NOTIF_RETRY_30S : QUEUES.NOTIF_RETRY_2M;
}

@Injectable()
export class NotificationEventsConsumer
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationEventsConsumer.name);
  private channelWrapper: ChannelWrapper | null = null;

  constructor(
    @Inject(MQ_CONNECTION) private readonly conn: AmqpConnectionManager | null,
    private readonly notifService: NotificationService,
  ) {}

  async onModuleInit() {
    if (!this.conn) {
      this.logger.warn("AMQP disabled. Notification consumer will not start.");
      return;
    }

    this.channelWrapper = this.conn.createChannel({
      setup: async (ch: ConfirmChannel) => {
        await bindNotificationTopology(ch);
        await ch.prefetch(10);

        // ★ ใช้คิวหลักของ notification: NOTIF_MAIN
        await ch.consume(
          QUEUES.NOTIF_MAIN,
          (msg) => msg && this.handleMessage(ch, msg),
          { noAck: false },
        );
      },
    });

    this.logger.log("NotificationEventsConsumer is ready.");
  }

  private handleMessage = async (ch: ConfirmChannel, msg: ConsumeMessage) => {
    const { routingKey, deliveryTag } = msg.fields;
    const headers = msg.properties.headers ?? {};
    const messageId = String(
      msg.properties.messageId ?? `no-message-id:${deliveryTag}`,
    );
    const retryCount = (headers["x-retries"] as number) ?? 0;
    const body = msg.content.toString("utf8");

    try {
      const payloadUnknown = safeJsonParse(body); // unknown | string

      console.log(payloadUnknown, "payloadUnknown");

      switch (routingKey) {
        case "orders.created":
        case "order.created": {
          if (!isOrderCreatedEvent(payloadUnknown)) {
            this.logger.warn("Malformed payload for orders.created");
            ch.ack(msg);
            break;
          }
          await this.notifService.handleOrderCreated(payloadUnknown);
          break;
        }
        case "orders.paid":
        case "order.paid": {
          if (!isOrderPaidEvent(payloadUnknown)) {
            this.logger.warn("Malformed payload for orders.paid");
            ch.ack(msg);
            break;
          }
          await this.notifService.handlePaid(payloadUnknown);
          break;
        }
        case "orders.shipped":
        case "order.shipped": {
          if (!isOrderShippedEvent(payloadUnknown)) {
            this.logger.warn("Malformed payload for orders.shipped");
            ch.ack(msg);
            break;
          }
          await this.notifService.handleShipped(payloadUnknown);
          break;
        }
        case "orders.delivered":
        case "order.delivered": {
          if (!isOrderDeliveredEvent(payloadUnknown)) {
            this.logger.warn("Malformed payload for orders.delivered");
            ch.ack(msg);
            break;
          }
          await this.notifService.handleDelivered(payloadUnknown);
          break;
        }
        case "orders.payment_failed": {
          if (!isOrderPaymentFailedEvent(payloadUnknown)) {
            this.logger.warn("Malformed payload for orders.payment_failed");
            ch.ack(msg);
            break;
          }
          await this.notifService.handlePaymentFailed(payloadUnknown);
          break;
        }
        case "orders.payment_expired": {
          if (!isOrderPaymentExpiredEvent(payloadUnknown)) {
            this.logger.warn("Malformed payload for orders.payment_expired");
            ch.ack(msg);
            break;
          }
          await this.notifService.handlePaymentExpired(payloadUnknown);
          break;
        }
        default:
          this.logger.debug(`Unhandled routingKey: ${routingKey}`);
      }

      ch.ack(msg);
    } catch (err) {
      this.logger.error(
        `Handler error on ${routingKey} [msgId=${messageId} try=${retryCount}] : ${(err as Error)?.message || err}`,
      );

      if (retryCount < MAX_RETRIES) {
        // ★ ใช้คิว retry ของ notification
        const retryQueue = pickNotifRetryQueue(retryCount);
        const opts: Options.Publish = {
          persistent: true,
          contentType: "application/json",
          messageId,
          headers: { ...headers, "x-retries": retryCount + 1 },
        };
        ch.sendToQueue(retryQueue, msg.content, opts);
        ch.ack(msg);
      } else {
        ch.nack(msg, false, false); // DLX → DLQ (ของ notif)
      }
    }
  };

  async onModuleDestroy() {
    try {
      await this.channelWrapper?.close();
      this.logger.log("NotificationEventsConsumer channel closed.");
    } catch {
      /* ignore */
    }
  }
}
