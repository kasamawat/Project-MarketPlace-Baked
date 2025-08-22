// mq.acm.ts
import { ChannelWrapper } from "amqp-connection-manager";
import { Options } from "amqplib";

export class AcmMqPublisher {
  constructor(private readonly channel: ChannelWrapper | null) {}

  async publishTopic(
    exchange: string,
    routingKey: string,
    payload: Record<string, any>,
    options: Options.Publish = {},
  ): Promise<void> {
    if (!this.channel) {
      // ไม่มี MQ (เช่น RABBITMQ_URL ไม่ถูกตั้ง) — ทำตัวเป็น no-op
      // แต่อย่างน้อย log ไว้

      console.warn(`[MQ] publish skipped: ${exchange} ${routingKey}`);
      return;
    }

    await this.channel.publish(
      exchange,
      routingKey,
      Buffer.from(
        typeof payload === "string" ? payload : JSON.stringify(payload),
      ),
      {
        persistent: true,
        contentType: "application/json",
        contentEncoding: "utf-8",
        timestamp: Date.now(),
        messageId:
          options?.messageId ?? `${exchange}:${routingKey}:${Date.now()}`,
        ...options,
        headers: {
          eventId: String(payload?.eventId),
          oredrId: String(payload?.orderId),
          ...options.headers,
        } as Record<string, any>,
      },
    );
  }
}
