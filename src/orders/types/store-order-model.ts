import { Types } from "mongoose";
import {
  AddressInfo,
  FulfillStatus,
  MasterStatus,
  StoreStatus,
} from "../schemas/shared.subdocs";

interface TimelineItem {
  type: string;
  at: Date;
  by?: string;
  payload?: Record<string, any>;
}

interface FulfillTimelineItem {
  type: string;
  at: Date;
  by?: string;
  payload?: Record<string, any>;
}

interface FulfillmentPackageItem {
  productId: Types.ObjectId;
  skuId: Types.ObjectId;
  qty: number;
  // (optional) snapshot ชื่อ (ช่วยแสดงผลเร็ว)
  attributes?: Record<string, string>;
  productName?: string;
}

interface FulfillmentPackage {
  _id: Types.ObjectId;
  code?: string;
  boxType?: string;
  weightKg?: number;
  dimension?: { l?: number; w?: number; h?: number };
  note?: string;

  items: FulfillmentPackageItem[];
  createdAt: Date;

  shipmentId?: Types.ObjectId;
  shippedAt?: Date;
}

interface FulfillmentShipment {
  _id: Types.ObjectId;
  carrier: string; // TH-EMS, TH-KERRY, ...
  trackingNumber: string;
  method?: "DROP_OFF" | "PICKUP";
  shippedAt?: Date;
  packageIds: Types.ObjectId[];
  note?: string;
  createdAt: Date;

  deliveredAt?: Date;
  returnedAt?: Date;
  failedAt?: Date;
}

interface FulfillmentInfo {
  status:
    | "UNFULFILLED"
    | "PARTIALLY_FULFILLED"
    | "FULFILLED"
    | "CANCELED"
    | "RETURNED";

  shippedItems: number;
  deliveredItems: number;
  totalItems: number;

  packages: FulfillmentPackage[];

  shipments: FulfillmentShipment[];

  timeline: TimelineItem[];
}

interface OrderItems {
  productId: Types.ObjectId;
  skuId: Types.ObjectId;
  storeId: Types.ObjectId;

  productName: string;
  productImage?: string;
  attributes: Record<string, string>;

  unitPrice: number;
  quantity: number;
  subtotal: number;

  packedQty: number;
  shippedQty: number;
  deliveredQty: number;
  canceledQty: number;

  fulfillStatus: FulfillStatus;

  fulfillTimeline: FulfillTimelineItem[];
}

interface Pricing {
  itemsTotal: number;
  shippingFee: number;
  discountTotal: number;
  taxTotal: number;
  grandTotal: number;
}

interface Contact {
  name?: string;
  email?: string;
  phone?: string;
}

interface Address {
  line1?: string;
  line2?: string;
  district?: string;
  province?: string;
  postalCode?: string;
  country?: string; // 'TH'
}

interface ShippingInfo {
  method?: string; // 'standard' | 'express' ...
  address?: Address;
  contact?: Contact;
}

export interface StoreOrderModelLean {
  _id: Types.ObjectId;
  masterOrderId: Types.ObjectId;
  storeId: Types.ObjectId;
  buyerId?: Types.ObjectId;

  buyerStatus: MasterStatus;

  status: StoreStatus;

  currency: string;

  items: OrderItems[];
  itemsCount: number;

  pricing: Pricing;

  shipping?: ShippingInfo;
  timeline: TimelineItem[];

  fulfillment?: FulfillmentInfo;

  shippingAddress?: AddressInfo;

  latestTrackingNo?: string;
  shippedAt?: Date;
  deliveredAt?: Date;
}
