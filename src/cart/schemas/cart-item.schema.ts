import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Types } from "mongoose";

export type CartItemDocument = CartItem & Document;

// cart-item.schema.ts
@Schema({ timestamps: true })
export class CartItem {
  @Prop({ type: Types.ObjectId, ref: "Cart", required: true })
  cartId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: "Product", required: true })
  productId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: "Sku", required: true })
  skuId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: "Store", required: true })
  storeId!: Types.ObjectId;

  // snapshot ตอนใส่ (กันราคาเปลี่ยนระหว่าง browse)
  @Prop({ required: true }) unitPrice!: number;
  @Prop({ default: 1 }) quantity!: number;
  @Prop({ default: 0 }) subtotal!: number; // = unitPrice * quantity

  // เพื่อแสดงผลเร็ว ไม่ต้อง join
  @Prop() productName!: string;
  @Prop() productImage?: string;
  @Prop({ type: Object, default: {} }) attributes!: Record<string, string>;
}
export const CartItemSchema = SchemaFactory.createForClass(CartItem);
CartItemSchema.index({ cartId: 1, skuId: 1 }, { unique: true }); // ✅ 1 sku ต่อ cart 1 แถว
