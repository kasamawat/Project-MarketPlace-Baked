import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import mongoose, { Document, Types } from "mongoose";

export type ProductDocument = Product & Document;
export type ProductVariantDocument = ProductVariant & Document;

@Schema({ timestamps: true, _id: true })
export class ProductVariant {
  @Prop()
  _id?: Types.ObjectId;

  @Prop({ required: true })
  name?: string;

  @Prop()
  value?: string;

  @Prop()
  image?: string;

  @Prop()
  price?: number;

  @Prop()
  stock?: number;

  @Prop({ type: [Object], default: [] }) // หรือ type: [ProductVariantSchema]
  variants?: ProductVariant[];
}

export const ProductVariantSchema =
  SchemaFactory.createForClass(ProductVariant);

@Schema({ timestamps: true })
export class Product {
  @Prop({ required: true })
  name: string;

  @Prop()
  description: string;

  @Prop({ required: true })
  category: string;

  @Prop({ required: true })
  type: string;

  @Prop()
  image: string;

  @Prop()
  price: number;

  @Prop()
  stock: number;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: "Store", required: true })
  storeId: Types.ObjectId; // หรือ Types.ObjectId

  @Prop({ type: [ProductVariantSchema], default: [] })
  variants?: ProductVariant[];

  @Prop({
    enum: ["draft", "pending", "published", "unpublished", "rejected"],
    default: "draft",
  })
  status: string;
}

export const ProductSchema = SchemaFactory.createForClass(Product);
