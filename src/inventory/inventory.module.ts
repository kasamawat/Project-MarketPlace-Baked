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

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InventoryLedger.name, schema: InventoryLedgerSchema },
      { name: Reservation.name, schema: ReservationSchema },
    ]),
    // ✅ ดึง SkuModel มาจาก SkusModule
    SkusModule,
  ],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
