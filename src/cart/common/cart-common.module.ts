import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Cart, CartSchema } from "../schemas/cart.schema";
import { CartResolverService } from "./cart-resolver.service";
import { CartItem, CartItemSchema } from "../schemas/cart-item.schema";
import { Sku, SkuSchema } from "src/skus/schemas/sku-schema";

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Cart.name, schema: CartSchema }]),
    MongooseModule.forFeature([
      { name: CartItem.name, schema: CartItemSchema },
    ]),
    MongooseModule.forFeature([{ name: Sku.name, schema: SkuSchema }]),
  ],
  providers: [CartResolverService],
  exports: [CartResolverService], // 👈 ให้คนอื่นใช้งานได้
})
export class CartCommonModule {}
