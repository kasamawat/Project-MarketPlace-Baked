// src/inventory/schemas/reservation.schema.ts
import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import mongoose, { Document, Types } from "mongoose";

export type ReservationDocument = Reservation & Document;

/**
 * สถานะการจอง:
 * - ACTIVE: จองอยู่ (นับรวมใน reserved)
 * - RELEASED: ปล่อยแล้ว (คืนสต็อกแล้ว) — เก็บไว้เพื่อ audit/analytics
 * - CONSUMED: ใช้ไปแล้ว (ตัดสต็อกตอนชำระเงินสำเร็จ/ออกสินค้า) — ไม่ต้องคืน
 */
export type ReservationStatus = "ACTIVE" | "RELEASED" | "CONSUMED";

@Schema({ timestamps: true })
export class Reservation {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: "Sku", required: true })
  skuId!: Types.ObjectId;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true,
  })
  productId!: Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: "Store", required: true })
  storeId!: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  qty!: number;

  /**
   * หมดเวลาการถือสิทธิ์ (ใช้ให้ reaper/cron ไปปล่อยเอง)
   * อย่าใช้ TTL ตรง ๆ กับ expiresAt เพราะเราต้อง "คืนสต็อก" ก่อนลบเอกสาร
   */
  @Prop({ required: true })
  expiresAt!: Date;

  /**
   * ผูกการจองกับแหล่งที่มา
   * - ระหว่าง checkout → อาจมี cartId
   * - หลังสร้าง MasterOrder → ควรอัปเดต masterOrderId เพื่อให้ release ตอน canceled/expired ที่ Master ได้ง่าย
   */
  @Prop() cartId?: Types.ObjectId;
  @Prop() userId?: Types.ObjectId;
  @Prop() masterOrderId?: Types.ObjectId; // ✅ แนะนำเพิ่ม
  @Prop() storeOrderId?: Types.ObjectId; // (ทางเลือก) ถ้าอยากผูกถึงระดับ store order

  /**
   * สถานะการจอง + ข้อมูลการปล่อย/ใช้สิทธิ์
   */
  @Prop({
    type: String,
    enum: ["ACTIVE", "RELEASED", "CONSUMED"],
    default: "ACTIVE",
  })
  status!: ReservationStatus;

  @Prop() releasedAt?: Date;
  @Prop() releasedReason?: string; // "payment_timeout" | "canceled" | "manual" | ...
  @Prop() releasedBy?: string; // 'system' | userId/adminId
  @Prop() consumedAt?: Date; // ตอนตัดสต็อกจริง (เช่นหลังจ่ายสำเร็จ/ออกสินค้า)
  @Prop() consumeRef?: string; // อ้างอิงเอกสารตัดสต็อก/DO/Invoice

  /**
   * ใช้สำหรับ TTL ลบซากข้อมูล "หลังจาก" เราคืนสต็อกแล้วเท่านั้น
   * ตัวอย่าง: ตั้งค่าเมื่อ status เปลี่ยนเป็น RELEASED/CONSUMED และอยากให้ลบออกใน 7-30 วัน
   */
  @Prop() purgeAfter?: Date; // ✅ ต้องมีเพื่อรองรับ TTL index ข้างล่าง
}
export const ReservationSchema = SchemaFactory.createForClass(Reservation);

/* ======================= Indexes & Notes ======================= */

// ❌ อย่าใช้ TTL บน expiresAt — เราต้องคืนสต็อกก่อนค่อยลบเอกสาร
// ReservationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// ✅ ใช้ TTL บน purgeAfter (เราจะ set ตอน RELEASED/CONSUMED แล้ว)
ReservationSchema.index({ purgeAfter: 1 }, { expireAfterSeconds: 0 });

// สำหรับงานค้นหา/ปล่อยและสรุปยอดเร็ว ๆ
ReservationSchema.index({ status: 1, expiresAt: 1 });
ReservationSchema.index({ masterOrderId: 1, status: 1 });
ReservationSchema.index({ cartId: 1, status: 1 });
ReservationSchema.index({ skuId: 1, storeId: 1, status: 1 });
ReservationSchema.index({ storeOrderId: 1, status: 1 }); // ถ้าใช้

// (ถ้ากลัวซ้ำซ้อนจากการยิง reserve ซ้ำ) ป้องกัน duplicate ในช่วง ACTIVE ต่อ key เดียวกัน (optional)
// ReservationSchema.index(
//   { skuId: 1, storeId: 1, masterOrderId: 1, status: 1 },
//   { unique: false }
// );
