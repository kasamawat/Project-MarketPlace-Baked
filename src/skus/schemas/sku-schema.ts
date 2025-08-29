import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import mongoose, { Document, Types } from "mongoose";

export type SkuDocument = Sku & Document;

@Schema({ timestamps: true, _id: true })
export class Sku {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true,
    index: true,
  })
  productId!: Types.ObjectId;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: "Store",
    required: true,
    index: true,
  })
  storeId!: Types.ObjectId;

  @Prop({ type: Object, required: true })
  attributes!: Record<string, string>;

  // ใช้คู่กับ unique compound
  @Prop({ required: true, index: true }) normalizedAttributes!: string;

  @Prop({ required: true, unique: true, index: true })
  skuCode!: string;

  @Prop() image?: string;
  @Prop() price?: number;

  @Prop({ default: 0, min: 0 }) onHand!: number;
  @Prop({ default: 0, min: 0 }) reserved!: number;
  // @Prop({ default: 0 }) available!: number;

  @Prop({ default: true }) purchasable!: boolean;
}

export const SkuSchema = SchemaFactory.createForClass(Sku);

SkuSchema.virtual("available").get(function (this: Sku) {
  const onHand = this.onHand ?? 0;
  const reserved = this.reserved ?? 0;
  return Math.max(0, onHand - reserved);
});

// ถ้าต้องการให้ virtual ติดไปใน JSON
SkuSchema.set("toJSON", { virtuals: true });
SkuSchema.set("toObject", { virtuals: true });

// กัน attributes ซ้ำใน product เดียวกัน
SkuSchema.index({ productId: 1, normalizedAttributes: 1 }, { unique: true });
SkuSchema.index({ productId: 1, skuCode: 1 }, { unique: true, sparse: true });
