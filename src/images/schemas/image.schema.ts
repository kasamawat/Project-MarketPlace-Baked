// src/images/image.schema.ts
import { Schema, SchemaFactory, Prop } from "@nestjs/mongoose";
import { Document, Schema as MSchema, Types } from "mongoose";
import {
  ImageEntityType,
  ImageRole,
  ImageStatus,
  ImageVisibility,
} from "../image.enums";

@Schema({ timestamps: true, collection: "images" })
export class Image {
  @Prop({ type: String, enum: ImageEntityType, required: true })
  entityType!: ImageEntityType;

  // ถ้าเป็น TEMP อาจยังไม่มี entityId -> optional
  @Prop({ type: MSchema.Types.ObjectId, refPath: "entityType" })
  entityId?: Types.ObjectId;

  // เพื่อกำหนดสิทธิ์/การค้นหาแยกร้าน
  @Prop({ type: MSchema.Types.ObjectId, ref: "Store" })
  storeId?: Types.ObjectId;

  // ใครอัปโหลด
  @Prop({ type: MSchema.Types.ObjectId, ref: "User", required: true })
  createdBy!: Types.ObjectId;

  @Prop({
    type: String,
    enum: ImageRole,
    required: true,
    default: ImageRole.Gallery,
  })
  role!: ImageRole;

  // รักษาลำดับรูปในแกลเลอรี (ตามที่คุณชอบ "preserve original order")
  @Prop({ type: Number, default: 0 })
  order!: number;

  @Prop({
    type: String,
    enum: ImageStatus,
    required: true,
    default: ImageStatus.Active,
  })
  status!: ImageStatus;

  @Prop({
    type: String,
    enum: ImageVisibility,
    default: ImageVisibility.Public,
  })
  visibility!: ImageVisibility;

  // ---------- Cloudinary meta ----------
  @Prop({ type: String, required: true }) publicId!: string; // ex: stores/{storeId}/products/{productId}/cover
  @Prop({ type: String, required: true }) url!: string; // delivery URL (เช่น f_auto,q_auto)
  @Prop({ type: Number }) width?: number;
  @Prop({ type: Number }) height?: number;
  @Prop({ type: Number }) bytes?: number;
  @Prop({ type: String }) format?: string;
  @Prop({ type: Number }) version?: number;
  @Prop({ type: String }) etag?: string;
  @Prop({ type: [String], default: [] }) tags!: string[];

  // ใช้สำหรับ TTL ลบ TEMP อัตโนมัติ (ใส่ค่าเฉพาะ TEMP)
  @Prop({ type: Date }) expireAt?: Date;

  // soft delete
  @Prop({ type: Date }) deletedAt?: Date;
}

export type ImageDocument = Image & Document;
export const ImageSchema = SchemaFactory.createForClass(Image);

// ----- Indexes -----
ImageSchema.index({ entityType: 1, entityId: 1, role: 1, order: 1 });
ImageSchema.index({ storeId: 1, createdAt: -1 });
ImageSchema.index({ createdBy: 1, createdAt: -1 });

// ให้มี "cover" ได้แค่ 1 รูป ต่อ entity (unique partial)
ImageSchema.index(
  { entityType: 1, entityId: 1, role: 1 },
  { unique: true, partialFilterExpression: { role: ImageRole.Cover } },
);

// TTL สำหรับ TEMP: ใส่ expireAfterSeconds ที่ index ของ expireAt
// หมายเหตุ: TTL index ใช้ได้เฉพาะ field Date และไม่รองรับ partial index
// แนวทาง: ใส่ expireAt เฉพาะเอกสารที่ status=TEMP เท่านั้น
ImageSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });
