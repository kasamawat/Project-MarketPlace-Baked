import { forwardRef, Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ProductController } from "./products.controller";
import { ProductService } from "./products.service";
import { ProductPublicController } from "./product-public.controller";
import { Store, StoreSchema } from "src/store/schemas/store.schema";
import { Product, ProductSchema } from "./schemas/product.schema";
import { InventoryModule } from "src/inventory/inventory.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: Store.name, schema: StoreSchema },
    ]),
    InventoryModule,
    forwardRef(() => InventoryModule),
  ],
  controllers: [ProductController, ProductPublicController],
  providers: [ProductService],
  exports: [ProductService],
})
export class ProductsModule {}
