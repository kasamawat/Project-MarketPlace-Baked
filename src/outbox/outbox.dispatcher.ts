// outbox/outbox.dispatcher.ts
import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { AmqpConnectionManager, ChannelWrapper } from "amqp-connection-manager";
import { ConfirmChannel } from "amqplib";
import { OutboxService } from "./outbox.service";
import { MQ_CONNECTION } from "src/messaging/mq.tokens";

// ตั้งค่า exchange
const EXCHANGE = "search";
const EX_TYPE = "topic";

@Injectable()
export class OutboxDispatcher implements OnModuleInit {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private channel!: ChannelWrapper;

  constructor(
    private readonly outbox: OutboxService,
    @Inject(MQ_CONNECTION) private readonly conn: AmqpConnectionManager,
  ) {}

  async onModuleInit() {
    this.channel = this.conn.createChannel({
      json: true,
      setup: async (ch: ConfirmChannel) => {
        await ch.assertExchange(EXCHANGE, EX_TYPE, { durable: true });
      },
    });

    // loop ง่าย ๆ ทุก 1 วินาที (ถ้าคุณมี @nestjs/schedule ใช้ @Interval ก็ได้)
    await this.tick();
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    setInterval(() => this.tick().catch(() => {}), 1000);
  }

  private async tick() {
    const jobs = await this.outbox.pullBatch(50);
    for (const j of jobs) {
      try {
        await this.channel.publish(EXCHANGE, j.topic, j.payload, {
          persistent: true,
          contentType: "application/json",
          messageId: `${String(j._id)}`,
          timestamp: Date.now(),
          // idempotency hint
          headers: { "x-idempotency-key": String(j._id) },
        });
        await this.outbox.markSent(j._id);
      } catch (err) {
        await this.outbox.markFailed(j._id, err, j.attempts ?? 0);
        this.logger.warn(
          `Publish failed: ${j.topic} ${String(j._id)} → ${String(err)}`,
        );
      }
    }
  }
}
