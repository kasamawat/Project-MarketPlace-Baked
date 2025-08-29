import { Module } from "@nestjs/common";
import { StoreController } from "./store.controller";
import { StoreService } from "./store.service";
import { MongooseModule } from "@nestjs/mongoose";
import { Store, StoreSchema } from "./schemas/store.schema";
import { Product, ProductSchema } from "src/products/schemas/product.schema";
import { OrdersModule } from "src/orders/orders.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: Store.name, schema: StoreSchema },
    ]),
    OrdersModule,
  ],
  controllers: [StoreController],
  providers: [StoreService],
  exports: [StoreService], // ถ้าต้องการใช้ที่อื่น
})
export class StoreModule {}
