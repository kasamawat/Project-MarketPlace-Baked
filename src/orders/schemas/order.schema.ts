// src/orders/schemas/order.schema.ts
import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";

export type OrderDocument = Order & Document;
export type OrderItemDocument = OrderItem & Document;

export type OrderStatus = "pending_payment" | "paid" | "canceled" | "expired";

// =========================== Subdoc ===========================
@Schema({ _id: false })
class PaymentInfo {
  @Prop() provider?: "stripe" | "promptpay" | "omise";
  @Prop() intentId?: string;
  @Prop() chargeId?: string;
  @Prop() status?:
    | "requires_action"
    | "processing"
    | "succeeded"
    | "failed"
    | "canceled";
  @Prop() amount?: number; // บาท
  @Prop() currency?: string; // 'THB'
  @Prop() receiptEmail?: string;
  @Prop({ type: Object }) meta?: Record<string, any>;
}

@Schema({ _id: false })
class TimelineItem {
  @Prop({ required: true }) type!: string; // 'order.created' | 'pi.processing' | ...
  @Prop({ required: true }) at!: Date;
  @Prop() by?: string; // 'system' | userId
  @Prop({ type: Object }) payload?: Record<string, any>;
}

@Schema({ _id: false })
class Pricing {
  @Prop({ default: 0 }) itemsTotal!: number;
  @Prop({ default: 0 }) shippingFee!: number;
  @Prop({ default: 0 }) discountTotal!: number;
  @Prop({ default: 0 }) taxTotal!: number;
  @Prop({ default: 0 }) grandTotal!: number;
}

@Schema({ _id: false })
class Contact {
  @Prop() name?: string;
  @Prop() email?: string;
  @Prop() phone?: string;
}

@Schema({ _id: false })
class Address {
  @Prop() line1?: string;
  @Prop() line2?: string;
  @Prop() district?: string;
  @Prop() province?: string;
  @Prop() postalCode?: string;
  @Prop() country?: string; // 'TH'
}

@Schema({ _id: false })
class ShippingInfo {
  @Prop() method?: string; // 'standard' | 'express' ...
  @Prop({ type: Address }) address?: Address;
  @Prop({ type: Contact }) contact?: Contact;
}

// ======================================================

@Schema({ _id: false })
export class OrderItem {
  @Prop({ type: Types.ObjectId, required: true }) productId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true }) skuId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true }) storeId!: Types.ObjectId;

  @Prop({ required: true }) productName!: string;
  @Prop() productImage?: string;

  @Prop({ type: Object, default: {} }) attributes!: Record<string, string>;

  @Prop({ required: true }) unitPrice!: number; // snapshot ตอนกดสั่ง
  @Prop({ required: true }) quantity!: number;
  @Prop({ required: true }) subtotal!: number; // = unitPrice * quantity
}
export const OrderItemSchema = SchemaFactory.createForClass(OrderItem);

@Schema({ timestamps: true })
export class Order {
  @Prop({ type: Types.ObjectId }) userId?: Types.ObjectId; // guest = undefined
  @Prop({ required: true }) cartId!: Types.ObjectId; // อ้าง cart ที่ใช้สร้าง
  @Prop({ required: true, default: "THB" }) currency!: string;

  @Prop({ type: [OrderItemSchema], default: [] }) items!: OrderItem[];

  @Prop({ required: true }) itemsCount!: number;
  @Prop({ required: true }) itemsTotal!: number;

  @Prop({
    type: String,
    required: true,
    enum: ["pending_payment", "paid", "canceled", "expired"],
  })
  status!: OrderStatus;

  @Prop({ type: PaymentInfo }) payment?: PaymentInfo;

  // ข้อมูลชำระเงินที่ต้องใช้ต่อ
  @Prop() paymentProvider?: string; // 'stripe' | 'omise' | 'xendit' | 'promptpay' ...
  @Prop() paymentIntentId?: string; // id จาก PSP
  @Prop() paymentLinkUrl?: string; // ถ้าใช้ Hosted Payment Link

  // paid
  @Prop() chargeId?: string; // <- เพิ่ม
  @Prop() paidAt?: Date; // <- เพิ่ม
  @Prop() paidAmount?: number; // <- เพิ่ม
  @Prop() paidCurrency?: string; // <- เพิ่ม
  @Prop() failureReason?: string; // <- เพิ่ม

  // TTL สำหรับการจองสินค้า (แสดงใน UI)
  @Prop() reservationExpiresAt?: Date;

  // idempotency
  @Prop() idemKey?: string; // header 'Idempotency-Key'

  @Prop({ type: [TimelineItem], default: [] }) timeline!: TimelineItem[];

  @Prop({ type: Pricing, default: {} }) pricing!: Pricing;

  @Prop({ type: ShippingInfo }) shipping?: ShippingInfo;
}
export const OrderSchema = SchemaFactory.createForClass(Order);

// Indexes
OrderSchema.index({ userId: 1, createdAt: -1 });
OrderSchema.index({ idemKey: 1 }, { unique: true, sparse: true });
OrderSchema.index({ paymentIntentId: 1 }, { sparse: true });
OrderSchema.index({ "payment.intentId": 1 }, { sparse: true });
OrderSchema.index(
  { reservationExpiresAt: 1 },
  {
    expireAfterSeconds: 0,
    partialFilterExpression: { status: "pending_payment" },
  },
);
