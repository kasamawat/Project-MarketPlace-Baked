import { Module } from "@nestjs/common";
import { CartController } from "./cart.controller";
import { CartService } from "./cart.service";
import { MongooseModule } from "@nestjs/mongoose";
import { Product, ProductSchema } from "src/products/schemas/product.schema";
import { Sku, SkuSchema } from "src/skus/schemas/sku-schema";
import { Store, StoreSchema } from "src/store/schemas/store.schema";
import { CartItem, CartItemSchema } from "./schemas/cart-item.schema";
import { Cart, CartSchema } from "./schemas/cart.schema";
import { CartCommonModule } from "./common/cart-common.module";

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Cart.name, schema: CartSchema }]),
    MongooseModule.forFeature([
      { name: CartItem.name, schema: CartItemSchema },
    ]),
    MongooseModule.forFeature([{ name: Sku.name, schema: SkuSchema }]),
    MongooseModule.forFeature([{ name: Product.name, schema: ProductSchema }]),
    MongooseModule.forFeature([{ name: Store.name, schema: StoreSchema }]),
    CartCommonModule,
  ],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
