import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Types } from "mongoose";

export type ReviewDocument = HydratedDocument<Review>;

@Schema({ timestamps: true, collection: "reviews" })
export class Review {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  masterOrderId!: Types.ObjectId; // masterOrderId
  @Prop({ type: Types.ObjectId, required: true, index: true })
  storeOrderId!: Types.ObjectId; // storeOrderId
  @Prop({ type: Types.ObjectId, required: true, index: true })
  storeId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true, index: true })
  buyerId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  productId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, index: true }) skuId?: Types.ObjectId;

  @Prop({ min: 1, max: 5, required: true }) rating!: number;
  @Prop({ maxlength: 1000 }) comment?: string;

  // ถ้าคุณมี ImagesService ก็เก็บเป็น image entity แยกได้
  @Prop({ type: [String], default: [] }) imageUrls!: string[];

  @Prop({ enum: ["published", "pending", "rejected"], default: "published" })
  status!: "published" | "pending" | "rejected";
}
export const ReviewSchema = SchemaFactory.createForClass(Review);

// ป้องกันรีวิวซ้ำต่อ 1 buyer/1 order-item
ReviewSchema.index(
  { masterOrderId: 1, storeOrderId: 1, buyerId: 1, productId: 1, skuId: 1 },
  { unique: true, name: "uniq_review_per_buyer_order_item" },
);
