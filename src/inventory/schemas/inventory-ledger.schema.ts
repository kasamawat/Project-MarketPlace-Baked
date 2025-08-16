// inventory-ledger.schema.ts
import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import mongoose, { Document, Types } from "mongoose";

export type InventoryLedgerDocument = InventoryLedger & Document;
export type InventoryOp =
  | "IN"
  | "OUT"
  | "RESERVE"
  | "RELEASE"
  | "COMMIT"
  | "RETURN";

@Schema({ timestamps: true })
export class InventoryLedger {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: "Sku", required: true })
  skuId!: Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: "Product" })
  productId?: Types.ObjectId; // ← เพิ่มได้ ถ้าอยาก query ตาม product

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: "Store" })
  storeId?: Types.ObjectId; // ← ถ้าต้องการแยกตามร้าน

  @Prop({ required: true }) op!: InventoryOp;
  @Prop({ required: true }) qty!: number;

  @Prop() referenceType?: string; // order/cart/payment
  @Prop() referenceId?: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: "Warehouse" })
  warehouseId?: Types.ObjectId;
  @Prop() note?: string;
}
export const InventoryLedgerSchema =
  SchemaFactory.createForClass(InventoryLedger);
InventoryLedgerSchema.index({ skuId: 1, createdAt: -1 });
