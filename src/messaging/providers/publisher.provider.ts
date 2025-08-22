import { Provider } from "@nestjs/common";
import { ChannelWrapper } from "amqp-connection-manager";
import { MQ_CHANNEL, MQ_PUBLISHER } from "../mq.tokens";
import { AcmMqPublisher } from "../mq.acm";
import { MqPublisher } from "../mq.types";

export const MqPublisherProvider: Provider = {
  provide: MQ_PUBLISHER,
  useFactory: (channel: ChannelWrapper | null): MqPublisher => {
    return new AcmMqPublisher(channel);
  },
  inject: [MQ_CHANNEL],
};
