// outbox/outbox.module.ts
import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Outbox, OutboxSchema } from "./schemas/outbox.schema";
import { OutboxService } from "./outbox.service";
import { OutboxDispatcher } from "./outbox.dispatcher";

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Outbox.name, schema: OutboxSchema }]),
  ],
  providers: [OutboxService, OutboxDispatcher],
  exports: [OutboxService],
})
export class OutboxModule {}
