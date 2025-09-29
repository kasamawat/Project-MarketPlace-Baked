import { Module } from "@nestjs/common";
import { NotificationService } from "./notification.service";
import { MongooseModule } from "@nestjs/mongoose";
import {
  Notification,
  NotificationSchema,
} from "./schemas/notification-schema";
import { UserNotificationsController } from "src/realtime/notifications/api/user-notifications.controller";
import {
  StoreOrder,
  StoreOrderSchema,
} from "src/orders/schemas/store-order.schema";
import { Store, StoreSchema } from "src/store/schemas/store.schema";
// ถ้ามี channel ย่อย เช่น email/push/in-app ก็ import providers ตรงนี้

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      { name: StoreOrder.name, schema: StoreOrderSchema },
      { name: Store.name, schema: StoreSchema },
    ]),
  ],
  providers: [NotificationService],
  controllers: [UserNotificationsController],
  exports: [NotificationService], // ให้ messaging นำไป inject ได้
})
export class NotificationModule {}
