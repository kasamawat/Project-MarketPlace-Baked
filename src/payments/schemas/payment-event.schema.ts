import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

@Schema({
  collection: "payment_events", // ตั้งชื่อ collection ให้ชัด (ไม่งั้น default = paymentevents)
  versionKey: false,
  timestamps: false, // เราเก็บ createdAt จาก Stripe เอง
})
export class PaymentEvent {
  // ใช้เก็บ Stripe Event ID เพื่อตรวจกันซ้ำ (unique)
  @Prop({ required: true, unique: true })
  id!: string;

  @Prop({ required: true })
  type!: string;

  // เวลาเกิด event ของ Stripe (ไม่ใช่เวลาบันทึกใน DB)
  @Prop({ required: true })
  createdAt!: Date;

  // (ตัวเลือก) เก็บ payload สำหรับ debug/ตรวจสอบย้อนหลัง
  @Prop({ type: Object })
  payload?: Record<string, any>;
}

// export type document
export type PaymentEventDocument = PaymentEvent & Document;

// สร้าง schema + index
export const PaymentEventSchema = SchemaFactory.createForClass(PaymentEvent);
// เผื่ออยากมี index เพิ่มเติม

PaymentEventSchema.index({ type: 1, createdAt: -1 });
