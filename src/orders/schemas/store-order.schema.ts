// src/orders/schemas/store-order.schema.ts
import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";
import {
  ShippingInfo,
  Pricing,
  TimelineItem,
  StoreStatus,
  FulfillStatus,
  FulfillmentInfo,
  AddressInfoSchema,
  AddressInfo,
  MasterStatus,
} from "./shared.subdocs";

export type StoreOrderDocument = StoreOrder & Document;

@Schema({ _id: false })
class FulfillTimelineItem {
  @Prop({ required: true }) type!: string;
  // | "fulfillment.packed"
  // | "fulfillment.shipped"
  // | "fulfillment.delivered";
  @Prop({ required: true }) at!: Date;
  @Prop() by?: string;
  @Prop({ type: Object }) payload?: Record<string, any>;
}

@Schema({ _id: false })
export class StoreOrderItem {
  @Prop({ type: Types.ObjectId, required: true }) productId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true }) skuId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true }) storeId!: Types.ObjectId;

  @Prop({ required: true }) productName!: string;
  @Prop() productImage?: string;
  @Prop({ type: Object, default: {} }) attributes!: Record<string, string>;

  @Prop({ required: true }) unitPrice!: number;
  @Prop({ required: true }) quantity!: number;
  @Prop({ required: true }) subtotal!: number;

  // ✅ ตัวนับ (ช่วยคิวรี/อัปเดตเร็ว)
  @Prop({ default: 0 }) packedQty!: number;
  @Prop({ default: 0 }) shippedQty!: number;
  @Prop({ default: 0 }) deliveredQty!: number;
  @Prop({ default: 0 }) canceledQty!: number;

  @Prop({
    type: String,
    enum: [
      "AWAITING_PAYMENT",
      "PENDING",
      "PARTIALLY_PACKED",
      "PACKED",
      "PARTIALLY_SHIPPED",
      "SHIPPED",
      "PARTIALLY_DELIVERED",
      "DELIVERED",
      "CANCELED",
    ],
    default: "AWAITING_PAYMENT",
  })
  fulfillStatus!: FulfillStatus;

  @Prop({ type: [FulfillTimelineItem], default: [] })
  fulfillTimeline!: FulfillTimelineItem[];
}
export const StoreOrderItemSchema =
  SchemaFactory.createForClass(StoreOrderItem);

@Schema({ timestamps: true })
export class StoreOrder {
  @Prop({ type: Types.ObjectId, required: true })
  masterOrderId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true }) storeId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId }) buyerId?: Types.ObjectId; // duplicate for query convenience

  @Prop({
    type: String,
    required: true,
    enum: ["pending_payment", "paid", "canceled", "expired", "refunded"],
  })
  buyerStatus!: MasterStatus; // mirror จาก master (จ่าย=paid), แต่ยกเลิก/หมดอายุอาจแยกตามร้านในบางเคส

  @Prop({
    type: String,
    required: true,
    enum: ["PENDING", "PACKED", "SHIPPED", "DELIVERED", "CANCELD", "RETURNED"],
  })
  status!: StoreStatus; // Status ของ store

  @Prop({ required: true, default: "THB" }) currency!: string;

  @Prop({ type: [StoreOrderItemSchema], default: [] }) items!: StoreOrderItem[];
  @Prop({ required: true }) itemsCount!: number;

  // pricing เฉพาะร้านนี้
  @Prop({ type: Pricing, default: {} }) pricing!: Pricing;

  @Prop({ type: ShippingInfo }) shipping?: ShippingInfo;
  @Prop({ type: [TimelineItem], default: [] }) timeline!: TimelineItem[]; // e.g. fulfillment events summary

  // Fulfillment Summary Items Fulfill
  @Prop({ type: FulfillmentInfo, default: {} }) fulfillment?: FulfillmentInfo;

  @Prop({ type: AddressInfoSchema }) shippingAddress?: AddressInfo; // snapshot เฉพาะร้าน

  // อาจเติม tracking-level fields เพื่อ list viewเร็ว
  @Prop() latestTrackingNo?: string;
  @Prop() shippedAt?: Date;
  @Prop() deliveredAt?: Date;
}
export const StoreOrderSchema = SchemaFactory.createForClass(StoreOrder);

// Indexes
StoreOrderSchema.index({ masterOrderId: 1 });
StoreOrderSchema.index({ storeId: 1, createdAt: -1 });
StoreOrderSchema.index({ storeId: 1, status: 1, createdAt: -1 });
StoreOrderSchema.index({ "items.skuId": 1 });
StoreOrderSchema.index({ buyerId: 1, createdAt: -1 });

StoreOrderSchema.index({ storeId: 1, "items.fulfillStatus": 1, createdAt: -1 });
// ถ้าใช้ summary ที่ระดับร้านด้วย
StoreOrderSchema.index({ storeId: 1, "fulfillment.status": 1, createdAt: -1 });
