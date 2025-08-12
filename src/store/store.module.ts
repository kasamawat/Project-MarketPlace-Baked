import { Module } from "@nestjs/common";
import { StoreController } from "./store.controller";
import { StoreService } from "./store.service";
import { MongooseModule } from "@nestjs/mongoose";
import { Store, StoreSchema } from "./schemas/store.schema";
import { StorePublicController } from "./store-public.controller";
import { Product, ProductSchema } from "src/products/schemas/product.schema";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: Store.name, schema: StoreSchema },
    ]),
  ],
  controllers: [StoreController, StorePublicController],
  providers: [StoreService],
  exports: [StoreService], // ถ้าต้องการใช้ที่อื่น
})
export class StoreModule {}
