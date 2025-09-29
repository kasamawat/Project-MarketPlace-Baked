// src/products/public/product-public.module.ts
import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Product, ProductSchema } from "../schemas/product.schema";
import { Sku, SkuSchema } from "src/skus/schemas/sku-schema";
import { ProductPublicController } from "./product-public.controller";
import { ProductPublicService } from "./product-public.service";
import { Store, StoreSchema } from "src/store/schemas/store.schema";
import { Image, ImageSchema } from "src/images/schemas/image.schema";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: Sku.name, schema: SkuSchema },
      { name: Store.name, schema: StoreSchema },
      { name: Image.name, schema: ImageSchema },
    ]),
  ],
  controllers: [ProductPublicController],
  providers: [ProductPublicService],
  exports: [ProductPublicService],
})
export class ProductPublicModule {}
