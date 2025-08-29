// src/orders/schemas/master-order.schema.ts
import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";
import { Pricing, TimelineItem, MasterStatus } from "./shared.subdocs";

export type MasterOrderDocument = MasterOrder & Document;

@Schema({ _id: false })
class PaymentInfo {
  @Prop() provider?: "stripe" | "promptpay" | "omise";
  @Prop() method?: "card" | "promptpay" | "cod";
  @Prop() intentId?: string;
  @Prop() chargeId?: string;
  @Prop() status?:
    | "requires_action"
    | "processing"
    | "succeeded"
    | "failed"
    | "canceled";
  @Prop() amount?: number;
  @Prop() currency?: string; // 'THB'
  @Prop() receiptEmail?: string;
  @Prop({ type: Object }) meta?: Record<string, any>;
}

@Schema({ timestamps: true })
export class MasterOrder {
  @Prop({ type: Types.ObjectId }) buyerId?: Types.ObjectId; // guest = undefined
  @Prop({ required: true, default: "THB" }) currency!: string;

  @Prop({
    type: String,
    required: true,
    enum: ["pending_payment", "paid", "canceled", "expired", "refunded"],
  })
  status!: MasterStatus;

  @Prop({ type: PaymentInfo }) payment?: PaymentInfo;
  @Prop() paymentProvider?: string;
  @Prop() paymentIntentId?: string;
  @Prop() paymentLinkUrl?: string;
  @Prop() chargeId?: string;
  @Prop() paidAt?: Date;
  @Prop() paidAmount?: number;
  @Prop() paidCurrency?: string;
  @Prop() failureReason?: string;

  // รวมทั้งเช็คเอาต์
  @Prop({ type: Pricing, default: {} }) pricing!: Pricing;
  @Prop({ required: true }) itemsCount!: number; // รวมทุก StoreOrder
  @Prop({ required: true }) storesCount!: number;

  // อ้าง cart / idempotency
  @Prop({ type: Types.ObjectId }) cartId?: Types.ObjectId;
  @Prop() idemKey?: string;

  // เวลา/หมดสิทธิ์จอง
  @Prop() reservationExpiresAt?: Date;
  @Prop() canceledAt?: Date;
  @Prop() expiredAt?: Date;

  // Timeline ระดับ master
  @Prop({ type: [TimelineItem], default: [] }) timeline!: TimelineItem[];
}
export const MasterOrderSchema = SchemaFactory.createForClass(MasterOrder);

// Indexes
MasterOrderSchema.index({ buyerId: 1, createdAt: -1 });
MasterOrderSchema.index({ idemKey: 1 }, { unique: true, sparse: true });
MasterOrderSchema.index({ paymentIntentId: 1 }, { sparse: true });
MasterOrderSchema.index({ status: 1, createdAt: -1 });
MasterOrderSchema.index({ reservationExpiresAt: 1, status: 1 });
