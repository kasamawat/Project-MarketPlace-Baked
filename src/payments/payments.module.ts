import { forwardRef, Module } from "@nestjs/common";
import { PaymentsService } from "./payments.service";
import { ConfigModule, ConfigService } from "@nestjs/config";
import Stripe from "stripe";
import { STRIPE_CLIENT } from "./constants";
import { PaymentsController } from "./payments.controller";
import { MessagingModule } from "src/messaging/messaging.module";
import { MongooseModule } from "@nestjs/mongoose";
import {
  WebhookEvent,
  WebhookEventSchema,
} from "./schemas/webhook-event.schema";
import { InventoryModule } from "src/inventory/inventory.module";
import { OrdersModule } from "src/orders/orders.module";
import {
  PaymentEvent,
  PaymentEventSchema,
} from "./schemas/payment-event.schema";
import {
  MasterOrder,
  MasterOrderSchema,
} from "src/orders/schemas/master-order.schema";

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: WebhookEvent.name, schema: WebhookEventSchema },
      { name: PaymentEvent.name, schema: PaymentEventSchema },
      { name: MasterOrder.name, schema: MasterOrderSchema },
    ]),
    forwardRef(() => OrdersModule), // ← ให้เห็น OrdersService
    InventoryModule,
    MessagingModule,
  ],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    {
      provide: STRIPE_CLIENT,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        const key = cfg.get<string>("STRIPE_SECRET_KEY")!;
        if (!key) {
          // จะเห็น error นี้แทน error ของ Stripe → ชี้จุดได้ง่ายกว่า
          throw new Error("STRIPE_SECRET_KEY is not defined");
        }
        return new Stripe(key, {
          apiVersion: "2025-07-30.basil",
          typescript: true,
        });
      },
    },
  ],
  exports: [PaymentsService, STRIPE_CLIENT],
})
export class PaymentsModule {}
