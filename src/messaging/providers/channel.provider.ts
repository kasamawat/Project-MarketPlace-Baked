import { Provider } from "@nestjs/common";
import { AmqpConnectionManager, ChannelWrapper } from "amqp-connection-manager";
import { MQ_CHANNEL, MQ_CONNECTION } from "../mq.tokens";
import { bindPaymentsTopology } from "../mq.topology";

export const MqChannelProvider: Provider = {
  provide: MQ_CHANNEL,
  useFactory: (conn: AmqpConnectionManager | null): ChannelWrapper | null => {
    if (!conn) return null;
    return conn.createChannel({
      json: false,
      setup: async (ch) => {
        await bindPaymentsTopology(ch); // assert exchanges/queues/bindings
      },
    });
  },
  inject: [MQ_CONNECTION],
};
