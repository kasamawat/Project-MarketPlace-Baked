import { forwardRef, Module } from "@nestjs/common";
import { WebhooksController } from "./webhooks.controller";
import { WebhooksService } from "./webhooks.service";
import {
  StoreOrder,
  StoreOrderSchema,
} from "src/orders/schemas/store-order.schema";
import { MongooseModule } from "@nestjs/mongoose";
import {
  CarrierWebhookEvent,
  CarrierWebhookEventSchema,
} from "./schemas/carrier-webhook-event.schema";
import { ConfigModule } from "@nestjs/config";
import { InventoryModule } from "src/inventory/inventory.module";
import { MessagingModule } from "src/messaging/messaging.module";
import { OrdersModule } from "src/orders/orders.module";
import {
  MasterOrder,
  MasterOrderSchema,
} from "src/orders/schemas/master-order.schema";
import {
  PaymentEvent,
  PaymentEventSchema,
} from "src/payments/schemas/payment-event.schema";
import {
  PaymentWebhookEvent,
  PaymentWebhookEventSchema,
} from "./schemas/payment-webhook-event.schema";
import { PaymentsModule } from "src/payments/payments.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CarrierWebhookEvent.name, schema: CarrierWebhookEventSchema },
      { name: PaymentWebhookEvent.name, schema: PaymentWebhookEventSchema },
      { name: StoreOrder.name, schema: StoreOrderSchema },
      { name: PaymentEvent.name, schema: PaymentEventSchema },
      { name: MasterOrder.name, schema: MasterOrderSchema },
    ]),
    ConfigModule,
    forwardRef(() => OrdersModule), // ← ให้เห็น OrdersService
    InventoryModule,
    MessagingModule,
    PaymentsModule,
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
