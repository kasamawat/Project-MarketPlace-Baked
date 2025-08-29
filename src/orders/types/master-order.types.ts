// src/orders/types/master-order.types.ts
import { Types } from "mongoose";

export type MasterListFacet = {
  data: MasterAggRow[];
  total: Array<{ count: number }>;
};

export type MasterAggRow = {
  _id: Types.ObjectId;
  createdAt: Date;
  currency: string;
  itemsPreview: {
    name: string;
    qty: number;
    image?: string;
    attributes: Record<string, string>;
  }[];
  itemsCount: number;
  itemsTotal: number;
  reservationExpiresAt?: Date;
  // fields อื่น ๆ ตาม pipeline
};

// ================= Types =================
export type PayCoreStatus = "pending_payment" | "paid" | "canceled" | "expired";
export type PayDetailStatus =
  | "requires_action"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled";

export type FulfillItemStatus =
  | "AWAITING_PAYMENT"
  | "PENDING"
  | "PACKED"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELED"
  | "RETURNED";
