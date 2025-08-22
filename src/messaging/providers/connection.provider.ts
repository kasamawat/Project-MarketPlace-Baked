import { Provider } from "@nestjs/common";
import { connect, AmqpConnectionManager } from "amqp-connection-manager";
import { MQ_CONNECTION } from "../mq.tokens";
import { parseAmqpUrls } from "../helper/mq-helper";

export const MqConnectionProvider: Provider = {
  provide: MQ_CONNECTION,
  useFactory: (): AmqpConnectionManager | null => {
    const urls = parseAmqpUrls(process.env.RABBITMQ_URL);
    if (!urls) return null;
    return connect(urls, {
      heartbeatIntervalInSeconds: 20,
      reconnectTimeInSeconds: 5,
    });
  },
};
