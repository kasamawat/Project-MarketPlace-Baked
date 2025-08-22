import { forwardRef, Module } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { MongooseModule } from "@nestjs/mongoose";
import { Cart, CartSchema } from "src/cart/schemas/cart.schema";
import { CartItem, CartItemSchema } from "src/cart/schemas/cart-item.schema";
import { Order, OrderSchema } from "./schemas/order.schema";
import { CartModule } from "src/cart/cart.module";
import { InventoryModule } from "src/inventory/inventory.module";
import { PaymentsModule } from "src/payments/payments.module";
import { OrdersController } from "./orders.controller";
import { RealtimeModule } from "src/realtime/realtime.module";

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Cart.name, schema: CartSchema }]),
    MongooseModule.forFeature([
      { name: CartItem.name, schema: CartItemSchema },
    ]),
    MongooseModule.forFeature([{ name: Order.name, schema: OrderSchema }]),
    CartModule,
    InventoryModule,
    PaymentsModule,
    RealtimeModule,
    // ถ้า Orders ใช้ Payments อยู่ด้วย ให้ใช้ forwardRef (มีวงจร):
    forwardRef(() => PaymentsModule), // ← มีได้เฉพาะกรณีจำเป็น
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
