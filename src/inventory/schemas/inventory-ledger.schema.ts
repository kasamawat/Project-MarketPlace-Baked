// inventory-ledger.schema.ts
import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import mongoose, { Document, Types } from "mongoose";

export type InventoryOp =
  | "IN"
  | "OUT"
  | "RESERVE"
  | "RELEASE"
  | "COMMIT"
  | "RETURN";

export type InventoryRefType =
  | "master_order"
  | "store_order"
  | "cart"
  | "cron"
  | "manual"
  | "webhook";

export interface InventoryLedgerDocument extends InventoryLedger, Document {}

@Schema({ timestamps: true })
export class InventoryLedger {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: "Sku", required: true })
  skuId!: Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: "Product" })
  productId?: Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: "Store" })
  storeId?: Types.ObjectId; // ถ้าไม่มี stock per store ก็ปล่อยว่างได้

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: "MasterOrder" })
  masterOrderId?: Types.ObjectId;

  @Prop({
    required: true,
    enum: ["IN", "OUT", "RESERVE", "RELEASE", "COMMIT", "RETURN"],
  })
  op!: InventoryOp;

  @Prop({ required: true, min: 1 })
  qty!: number; // delta เป็นจำนวนบวกเสมอ

  @Prop({
    required: false,
    enum: ["master_order", "store_order", "cart", "cron", "manual", "webhook"],
  })
  referenceType?: InventoryRefType;

  @Prop({ type: mongoose.Schema.Types.ObjectId })
  referenceId?: Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: "Warehouse" })
  warehouseId?: Types.ObjectId;

  // อธิบายสาเหตุ (เช่น payment_timeout | user_canceled | stripe_failed ฯลฯ)
  @Prop() reason?: string;

  // กันซ้ำระหว่าง retry (เช่น messageId ของ MQ / compose key เอง)
  @Prop() idemKey?: string;

  @Prop() note?: string;
}

export const InventoryLedgerSchema =
  SchemaFactory.createForClass(InventoryLedger);

// ------ Indexes ------
// query ล่าสุดของ SKU
InventoryLedgerSchema.index({ skuId: 1, createdAt: -1 });

// รายงานตามเหตุการณ์ + เวลา
InventoryLedgerSchema.index({ op: 1, createdAt: -1 });

// หา ledger ของ master ได้ไว
InventoryLedgerSchema.index({ masterOrderId: 1, createdAt: -1 });

// กันซ้ำ: ถ้ามี idemKey ให้ unique
InventoryLedgerSchema.index({ idemKey: 1 }, { unique: true, sparse: true });

// (ทางเลือก) ถ้าอยากกันซ้ำโดยไม่มี idemKey ให้คอมโพสิตแบบนี้ (ปรับให้เข้ากับระบบจริง)
// InventoryLedgerSchema.index(
//   { op: 1, skuId: 1, referenceType: 1, referenceId: 1, reason: 1 },
//   { unique: true, sparse: true }
// );
