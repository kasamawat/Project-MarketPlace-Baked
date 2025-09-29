import { Module, Global } from "@nestjs/common";
import { SseBus } from "./sse.bus";
import { NotificationsStreamController } from "./notifications/notifications.stream.controller";
import { OrderPaymentStreamController } from "./order-payment/order-payment.stream.controller";
import {
  MasterOrder,
  MasterOrderSchema,
} from "src/orders/schemas/master-order.schema";
import { MongooseModule } from "@nestjs/mongoose";

/** ถ้าต้องการใช้ได้ทุกที่โดยไม่ต้อง import ทุกโมดูล ให้ใส่ @Global() */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MasterOrder.name, schema: MasterOrderSchema },
    ]),
  ],
  controllers: [NotificationsStreamController, OrderPaymentStreamController],
  providers: [SseBus],
  exports: [SseBus],
})
export class RealtimeModule {}
