import { MqConnectionProvider } from "./connection.provider";
import { MqChannelProvider } from "./channel.provider";
import { MqPublisherProvider } from "./publisher.provider";
import { MqShutdown } from "./shutdown.provider";

export const MQ_PROVIDERS = [
  MqConnectionProvider,
  MqChannelProvider,
  MqPublisherProvider,
  MqShutdown,
];
