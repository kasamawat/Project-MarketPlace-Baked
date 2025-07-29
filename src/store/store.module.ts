import { Module } from "@nestjs/common";
import { StoreController } from "./store.controller";
import { StoreService } from "./store.service";
import { MongooseModule } from "@nestjs/mongoose";
import { Store, StoreSchema } from "./store.schema";

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Store.name, schema: StoreSchema }]),
  ],
  controllers: [StoreController],
  providers: [StoreService],
  exports: [StoreService], // ถ้าต้องการใช้ที่อื่น
})
export class StoreModule {}
