// src/orders/schemas/shared.subdocs.ts
import { Prop, Schema } from "@nestjs/mongoose";

@Schema({ _id: false })
export class TimelineItem {
  @Prop({ required: true }) type!: string; // 'order.created' | 'order.paid' | ...
  @Prop({ required: true }) at!: Date;
  @Prop() by?: string; // 'system' | userId
  @Prop({ type: Object }) payload?: Record<string, any>;
}

@Schema({ _id: false })
export class Pricing {
  @Prop({ default: 0 }) itemsTotal!: number;
  @Prop({ default: 0 }) shippingFee!: number;
  @Prop({ default: 0 }) discountTotal!: number;
  @Prop({ default: 0 }) taxTotal!: number;
  @Prop({ default: 0 }) grandTotal!: number;
}

@Schema({ _id: false })
export class Contact {
  @Prop() name?: string;
  @Prop() email?: string;
  @Prop() phone?: string;
}

@Schema({ _id: false })
export class Address {
  @Prop() line1?: string;
  @Prop() line2?: string;
  @Prop() district?: string;
  @Prop() province?: string;
  @Prop() postalCode?: string;
  @Prop() country?: string; // 'TH'
}

@Schema({ _id: false })
export class ShippingInfo {
  @Prop() method?: string; // 'standard' | 'express' ...
  @Prop({ type: Address }) address?: Address;
  @Prop({ type: Contact }) contact?: Contact;
}

export type MasterStatus =
  | "pending_payment"
  | "paid"
  | "canceled"
  | "expired"
  | "refunded";
export type StoreStatus = "pending_payment" | "paid" | "canceled" | "expired"; // การจ่ายอยู่ที่ master เป็นหลัก
export type FulfillStatus =
  | "AWAITING_PAYMENT"
  | "PENDING"
  | "PACKED"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELED"
  | "RETURNED";

// ===================================== Fulfillment =====================================
type FulfillEvent =
  | "fulfillment.ready"
  | "fulfillment.packed"
  | "fulfillment.shipped"
  | "fulfillment.delivered"
  | "fulfillment.canceled"
  | "fulfillment.returned";
@Schema({ _id: false })
class FulfillTimelineItem {
  @Prop({ required: true })
  type!: FulfillEvent; // <— แยกจาก status จะชัดขึ้น
  @Prop({ required: true }) at!: Date;
  @Prop() by?: string;
  @Prop({ type: Object }) payload?: Record<string, any>;
}
@Schema({ _id: false })
export class FulfillmentInfo {
  @Prop({
    type: String,
    enum: [
      "UNFULFILLED",
      "PARTIALLY_FULFILLED",
      "FULFILLED",
      "CANCELED",
      "RETURNED",
    ],
    default: "UNFULFILLED",
  })
  status!:
    | "UNFULFILLED"
    | "PARTIALLY_FULFILLED"
    | "FULFILLED"
    | "CANCELED"
    | "RETURNED";

  @Prop({ default: 0 }) shippedItems!: number;
  @Prop({ default: 0 }) deliveredItems!: number;
  @Prop({ default: 0 }) totalItems!: number;

  // สรุปเหตุการณ์ระดับร้าน (เช่น first shipped / all delivered)
  @Prop({ type: [FulfillTimelineItem], default: [] })
  timeline!: FulfillTimelineItem[];
}
