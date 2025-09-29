import { Types } from "mongoose";
import { MasterStatus, StoreStatus } from "../schemas/shared.subdocs";

type ImageItemDto = {
  _id: string;
  role: string;
  order: number;
  publicId: string;
  version?: number;
  width?: number;
  height?: number;
  format?: string;
  url?: string; // ถ้าเก็บไว้
};

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
  cover: ImageItemDto;
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
  buyerStatus: MasterStatus;
  storeStatus: StoreStatus;
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

export type StoreOrderItems = {
  masterOrderId: string;
  storeOrderId: string;
  createdAt: string;
  itemsPreview: StoreItemPreview[];
  itemsCount: number;
  itemsTotal: number;
  currency: string;
  buyerStatus: MasterStatus;
  storeStatus: StoreStatus;
  fulfillment: Fulfillment;
  buyer: { name: string; email: string };
};
