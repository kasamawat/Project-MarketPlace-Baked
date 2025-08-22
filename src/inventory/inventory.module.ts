import { Module } from "@nestjs/common";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";
import { MongooseModule } from "@nestjs/mongoose";
import {
  InventoryLedger,
  InventoryLedgerSchema,
} from "./schemas/inventory-ledger.schema";
import { Reservation, ReservationSchema } from "./schemas/reservation.schema";
import { SkusModule } from "src/skus/skus.module";
import { Order, OrderSchema } from "src/orders/schemas/order.schema";
import { Sku, SkuSchema } from "src/skus/schemas/sku-schema";
import { InventoryCommonModule } from "./common/inventory-common.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InventoryLedger.name, schema: InventoryLedgerSchema },
      { name: Reservation.name, schema: ReservationSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Sku.name, schema: SkuSchema },
    ]),
    // ✅ ดึง SkuModel มาจาก SkusModule
    SkusModule,
    InventoryCommonModule,
  ],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
