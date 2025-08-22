import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Reservation, ReservationSchema } from "../schemas/reservation.schema";
import { InventoryResolverService } from "./inventory-resolver.service";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Reservation.name, schema: ReservationSchema },
    ]),
  ],
  providers: [InventoryResolverService],
  exports: [InventoryResolverService], // 👈 ให้คนอื่นใช้งานได้
})
export class InventoryCommonModule {}
