import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Types } from "mongoose";

export type StoreFollowDocument = HydratedDocument<StoreFollow>;

@Schema({
  timestamps: { createdAt: true, updatedAt: true },
  toJSON: { virtuals: true, versionKey: false },
  toObject: { virtuals: true, versionKey: false },
  collection: "store_follows",
})
export class StoreFollow {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  storeId: Types.ObjectId;

  @Prop({ type: Date })
  deletedAt?: Date;
}

export const StoreFollowSchema = SchemaFactory.createForClass(StoreFollow);

// กัน follow ซ้ำ เฉพาะเรคอร์ดที่ยัง active
StoreFollowSchema.index(
  { userId: 1, storeId: 1 },
  { unique: true, name: "uniq_follow_per_user_store" },
);

// คิวรีที่เจอบ่อย
StoreFollowSchema.index(
  { userId: 1, deletedAt: 1, createdAt: -1 },
  { name: "by_user_active_created" },
);
StoreFollowSchema.index(
  { storeId: 1, deletedAt: 1, createdAt: -1 },
  { name: "by_store_active_created" },
);
