import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Product, ProductSchema } from "./product.schema";
import { ProductController } from "./products.controller";
import { ProductService } from "./products.service";
import { ProductPublicController } from "./product-public.controller";
import { Store, StoreSchema } from "src/store/store.schema";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: Store.name, schema: StoreSchema },
    ]),
  ],
  controllers: [ProductController, ProductPublicController],
  providers: [ProductService],
  exports: [ProductService],
})
export class ProductsModule {}
