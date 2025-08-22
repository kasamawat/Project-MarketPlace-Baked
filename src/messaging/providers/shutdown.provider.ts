import { Inject, Injectable, OnApplicationShutdown } from "@nestjs/common";
import { AmqpConnectionManager } from "amqp-connection-manager";
import { MQ_CONNECTION } from "../mq.tokens";

@Injectable()
export class MqShutdown implements OnApplicationShutdown {
  constructor(
    @Inject(MQ_CONNECTION) private readonly conn: AmqpConnectionManager | null,
  ) {}

  async onApplicationShutdown() {
    if (this.conn) {
      try {
        await this.conn.close();
      } catch {
        /* ignore */
      }
    }
  }
}
