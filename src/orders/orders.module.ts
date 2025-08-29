import { Module } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { MongooseModule } from "@nestjs/mongoose";
import { Cart, CartSchema } from "src/cart/schemas/cart.schema";
import { CartItem, CartItemSchema } from "src/cart/schemas/cart-item.schema";
import { CartModule } from "src/cart/cart.module";
import { InventoryModule } from "src/inventory/inventory.module";
import { PaymentsModule } from "src/payments/payments.module";
import { OrdersController } from "./orders.controller";
import { RealtimeModule } from "src/realtime/realtime.module";
import { OrdersExpiryReaper } from "./orders-expiry.reaper";
import { MasterOrder, MasterOrderSchema } from "./schemas/master-order.schema";
import { StoreOrder, StoreOrderSchema } from "./schemas/store-order.schema";
import {
  Reservation,
  ReservationSchema,
} from "src/inventory/schemas/reservation.schema";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Cart.name, schema: CartSchema },
      { name: CartItem.name, schema: CartItemSchema },
      { name: MasterOrder.name, schema: MasterOrderSchema },
      { name: StoreOrder.name, schema: StoreOrderSchema },
      { name: Reservation.name, schema: ReservationSchema },
    ]),
    CartModule,
    InventoryModule,
    PaymentsModule,
    RealtimeModule,
    // ถ้า Orders ใช้ Payments อยู่ด้วย ให้ใช้ forwardRef (มีวงจร):
    // forwardRef(() => PaymentsModule), // ← มีได้เฉพาะกรณีจำเป็น
  ],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersExpiryReaper],
  exports: [OrdersService],
})
export class OrdersModule {}
