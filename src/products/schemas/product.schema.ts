import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import mongoose, { Document, Types } from "mongoose";

export type ProductDocument = Product & Document;

@Schema({ timestamps: true })
export class Product {
  @Prop({ required: true }) name!: string;
  @Prop() description?: string;

  @Prop({ required: true }) category!: string;
  @Prop({ required: true }) type!: string;

  @Prop() image?: string;

  // ราคาเริ่มต้น (ใช้ fallback ให้ SKU ถ้า SKU ไม่กำหนด)
  @Prop() defaultPrice?: number;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: "Store",
    required: true,
    index: true,
  })
  storeId!: Types.ObjectId;

  @Prop({
    enum: ["draft", "pending", "published", "unpublished", "rejected"],
    default: "draft",
  })
  status!: string;
}

export const ProductSchema = SchemaFactory.createForClass(Product);
