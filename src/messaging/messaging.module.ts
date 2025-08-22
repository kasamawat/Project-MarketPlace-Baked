import { Module, Global } from "@nestjs/common";
import { MQ_CHANNEL, MQ_CONNECTION, MQ_PUBLISHER } from "./mq.tokens";
import { PaymentsEventsConsumer } from "./payments-events.consumer";
import { MQ_PROVIDERS } from "./providers";
import { RealtimeModule } from "src/realtime/realtime.module";

@Global()
@Module({
  imports: [RealtimeModule],
  providers: [...MQ_PROVIDERS, PaymentsEventsConsumer],
  exports: [MQ_PUBLISHER, MQ_CONNECTION, MQ_CHANNEL],
})
export class MessagingModule {}
