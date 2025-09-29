import { Module, Global } from "@nestjs/common";
import { MQ_CHANNEL, MQ_CONNECTION, MQ_PUBLISHER } from "./mq.tokens";
import { PaymentsEventsConsumer } from "./consumers/payments-events.consumer";
import { MQ_PROVIDERS } from "./providers";
import { RealtimeModule } from "src/realtime/realtime.module";
import { NotificationEventsConsumer } from "./consumers/notification-events.consumer";
import { NotificationModule } from "src/notification/notification.module";
import { SearchIndexConsumer } from "./consumers/searchIndex-events.consumer";

@Global()
@Module({
  imports: [RealtimeModule, NotificationModule],
  providers: [
    ...MQ_PROVIDERS,
    PaymentsEventsConsumer,
    NotificationEventsConsumer,
    SearchIndexConsumer,
  ],
  exports: [MQ_PUBLISHER, MQ_CONNECTION, MQ_CHANNEL],
})
export class MessagingModule {}
