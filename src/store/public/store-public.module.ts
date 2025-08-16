import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Product, ProductSchema } from "src/products/schemas/product.schema";
import { Store, StoreSchema } from "../schemas/store.schema";
import { StorePublicController } from "./store-public.controller";
import { StorePublicService } from "./store-public.service";
import { Sku, SkuSchema } from "src/skus/schemas/sku-schema";
import { StoreCommonModule } from "../common/store-common.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: Store.name, schema: StoreSchema },
      { name: Sku.name, schema: SkuSchema },
    ]),
    StoreCommonModule,
  ],
  controllers: [StorePublicController],
  providers: [StorePublicService],
  exports: [StorePublicService], // ถ้าต้องการใช้ที่อื่น
})
export class StorePublicModule {}
