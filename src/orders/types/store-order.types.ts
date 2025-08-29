import { Types } from "mongoose";

type StoreOrderStatus =
  | "pending_payment"
  | "paying"
  | "processing"
  | "paid"
  | "expired"
  | "canceled";

type StoreItemPreview = {
  name: string;
  qty: number;
  attributes: Record<string, string>;
  fulfillStatus:
    | "AWAITING_PAYMENT"
    | "PENDING"
    | "PACKED"
    | "SHIPPED"
    | "DELIVERED"
    | "CANCELED"
    | "RETURNED";
};

type FulfillmentStatus =
  | "UNFULFILLED"
  | "PARTIALLY_FULFILLED"
  | "FULFILLED"
  | "CANCELED"
  | "RETURNED";

type StoreAggRow = {
  _id: Types.ObjectId;
  masterOrderId: Types.ObjectId;
  createdAt: Date;
  currency: string;
  status: StoreOrderStatus;
  itemsPreview: StoreItemPreview[];
  itemsCount: number;
  itemsTotal: number;
  fulfillment: Fulfillment;
  buyer: { name: string; email: string };
};

type Fulfillment = {
  status: FulfillmentStatus;
  shippedItems: number;
  deliveredItems: number;
  totalItems: number;
};

// ← นี่คือ “หนึ่งเอกสาร” ที่ออกจาก pipeline (เพราะเราใช้ $facet)
export type StoreOrderFacet = {
  data: StoreAggRow[];
  total: { count: number }[];
};

export type StoreOrderDetailItem = {
  masterOrderId: string;
  storeOrderId: string;
  createdAt: string;
  itemsPreview: StoreItemPreview[];
  itemsCount: number;
  itemsTotal: number;
  currency: string;
  status: StoreOrderStatus;
  fulfillment: Fulfillment;
  buyer: { name: string; email: string };
};
