import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ProductsController } from "./products.controller";
import { ProductsService } from "./products.service";
import { Product, ProductSchema } from "./schemas/product.schema";
import { SkusModule } from "src/skus/skus.module";
import { InventoryModule } from "src/inventory/inventory.module";
import {
  StoreOrder,
  StoreOrderSchema,
} from "src/orders/schemas/store-order.schema";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: StoreOrder.name, schema: StoreOrderSchema },
    ]),
    SkusModule,
    InventoryModule,
  ],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
