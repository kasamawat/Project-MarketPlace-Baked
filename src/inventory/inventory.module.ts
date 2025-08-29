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
import { Sku, SkuSchema } from "src/skus/schemas/sku-schema";
import { InventoryCommonModule } from "./common/inventory-common.module";
import {
  MasterOrder,
  MasterOrderSchema,
} from "src/orders/schemas/master-order.schema";
import {
  StoreOrder,
  StoreOrderSchema,
} from "src/orders/schemas/store-order.schema";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InventoryLedger.name, schema: InventoryLedgerSchema },
      { name: Reservation.name, schema: ReservationSchema },
      { name: Sku.name, schema: SkuSchema },
      { name: MasterOrder.name, schema: MasterOrderSchema },
      { name: StoreOrder.name, schema: StoreOrderSchema },
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
