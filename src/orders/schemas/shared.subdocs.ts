// src/orders/schemas/shared.subdocs.ts
import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Types } from "mongoose";

@Schema({ _id: false })
export class TimelineItem {
  @Prop({ required: true }) type!: string;
  @Prop({ required: true }) at!: Date;
  @Prop() by?: string;
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
  | "refunded"; // status สำหรับ buyer
export type StoreStatus =
  | "PENDING"
  | "PACKED"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELD"
  | "RETURNED"; // status สำหรับ seller
export type FulfillStatus =
  | "AWAITING_PAYMENT"
  | "PENDING"
  | "PARTIALLY_PACKED"
  | "PACKED"
  | "PARTIALLY_SHIPPED"
  | "SHIPPED"
  | "PARTIALLY_DELIVERED"
  | "DELIVERED"
  | "CANCELED";

@Schema({ _id: false })
class FulfillmentPackageItem {
  @Prop({ type: Types.ObjectId, required: true }) productId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true }) skuId!: Types.ObjectId;
  @Prop({ required: true }) qty!: number;
  // (optional) snapshot ชื่อ (ช่วยแสดงผลเร็ว)
  @Prop() productName?: string;
}

@Schema({ _id: true })
class FulfillmentPackage {
  @Prop() code?: string; // e.g. BOX-0001
  @Prop() boxType?: string; // BOX-S|M|L|CUSTOM
  @Prop() weightKg?: number;
  @Prop({ type: Object }) dimension?: { l?: number; w?: number; h?: number };
  @Prop() note?: string;
  @Prop({ type: [FulfillmentPackageItem], default: [] })
  items!: FulfillmentPackageItem[];
  @Prop({ default: () => new Date() }) createdAt!: Date;

  // ref shipment ที่ส่งกล่องนี้
  @Prop({ type: Types.ObjectId }) shipmentId?: Types.ObjectId;
  @Prop() shippedAt?: Date;
}

@Schema({ _id: true })
class FulfillmentShipment {
  @Prop({ required: true }) carrier!: string; // TH-EMS, TH-KERRY, ...
  @Prop({ required: true }) trackingNumber!: string;
  @Prop() method?: "DROP_OFF" | "PICKUP";
  @Prop() shippedAt?: Date;
  @Prop({ type: [Types.ObjectId], default: [] }) packageIds!: Types.ObjectId[];
  @Prop() note?: string;
  @Prop({ default: () => new Date() }) createdAt!: Date;

  @Prop() deliveredAt?: Date;
  @Prop() returnedAt?: Date;
  @Prop() failedAt?: Date;
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

  @Prop({ type: [FulfillmentPackage], default: [] })
  packages!: FulfillmentPackage[];
  @Prop({ type: [FulfillmentShipment], default: [] })
  shipments!: FulfillmentShipment[];

  @Prop({ type: [TimelineItem], default: [] }) timeline!: TimelineItem[];
}

@Schema({ _id: false })
export class AddressInfo {
  @Prop() name?: string;
  @Prop() phone?: string;
  @Prop() line1?: string;
  @Prop() line2?: string;
  @Prop() district?: string; // อำเภอ/เขต
  @Prop() subDistrict?: string; // ตำบล/แขวง
  @Prop() province?: string;
  @Prop() postalCode?: string;
  @Prop() country?: string;
  @Prop() note?: string; // โน้ตจากผู้ซื้อ (เช่น ฝากไว้หน้าบ้าน)
}
export const AddressInfoSchema = SchemaFactory.createForClass(AddressInfo);
