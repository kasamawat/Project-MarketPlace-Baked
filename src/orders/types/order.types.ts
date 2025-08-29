import { PlaceOrderDto } from "../dto/place-order.dto";

export type Args = {
  dto: PlaceOrderDto;
  userId: string;
  cartKey: string;
  idemKey?: string;
  setCookie: (k: string, v: string, maxAgeSec: number) => void;
};

export type MarkPayingInput = {
  paymentIntentId: string;
  amount?: number; // หน่วยเป็นบาท (float) ถ้าอยากเก็บเป็นสตางค์ ให้เปลี่ยนเป็น number ของสตางค์
  currency?: string; // 'thb' ฯลฯ
  provider?: string;
};

export type MarkPaidArgs = {
  paymentIntentId: string;
  chargeId?: string;
  paidAt?: Date;
  amount: number; // ที่จ่ายจริง (เช่น amount_received/100)
  currency: string; // 'thb' หรือ 'THB' แล้วแต่เก็บ
};

export type MarkCanceledArgs = {
  paymentIntentId?: string;
  failureReason?: string; // 'payment_failed' | 'canceled' | รายละเอียด error จาก Stripe
  canceledAt?: Date;
};

export type MarkExpiredArgs = {
  reason?: string; // default: 'payment_timeout'
  expiredAt?: Date;
};

export type PayMetaOut = {
  masterOrderId: string;
  status: "pending_payment" | "paid" | "canceled" | "expired" | "refunded";
  reservationExpiresAt?: string; // ISO
  clientSecret?: string; // เฉพาะกรณี online payment + pending_payment
  serverNow: string; // ISO
  amount: number;
  currency: string;
  provider?: string;
};

import { Types } from "mongoose";

export type StoreItemPreview = {
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

export type StoreDataRow = {
  _id: Types.ObjectId;
  masterOrderId: Types.ObjectId;
  createdAt: Date;
  currency: string;
  status:
    | "pending_payment"
    | "paying"
    | "processing"
    | "paid"
    | "expired"
    | "canceled";
  itemsPreview: StoreItemPreview[];
  storeItemsCount: number;
  storeItemsTotal: number;
};

// ← นี่คือ “หนึ่งเอกสาร” ที่ออกจาก pipeline (เพราะเราใช้ $facet)
export type StoreFacet = {
  data: StoreDataRow[];
  total: { count: number }[];
};

/** สถานะที่หน้า Buyer ใช้โชว์ */
export type BuyerListStatus =
  | "pending_payment"
  | "paying"
  | "processing"
  | "paid"
  | "expired"
  | "canceled";

/** ชิ้นสินค้าสำหรับ preview ใน list */
export interface PreviewItem {
  name: string;
  qty: number;
  image?: string;
  attributes?: Record<string, string>;
}

/** แถวข้อมูลหนึ่งเอกสารจาก facet.data (ผลหลัง $project) */
export interface MasterListAggRow {
  _id: Types.ObjectId;
  createdAt: Date;
  currency: string;
  status: "pending_payment" | "paid" | "expired" | "canceled"; // ค่า raw จาก master
  payment?: {
    status?:
      | "requires_action"
      | "processing"
      | "succeeded"
      | "failed"
      | "canceled";
  };
  reservationExpiresAt?: Date;
  itemsPreview: PreviewItem[];
  itemsTotal: number;
  itemsCount: number;
}

/** เอกสารที่ pipeline คืนมาหนึ่งตัว (เพราะเราใช้ $facet) */
export interface MasterListFacet {
  data: MasterListAggRow[];
  total: Array<{ count: number }>;
}

/** Shape ที่ service จะส่งให้ controller/FE */
export interface BuyerListRow {
  masterOrderId: string;
  createdAt: string; // ISO
  currency: string;
  status: BuyerListStatus; // mapped จาก master+payment
  reservationExpiresAt?: string; // ISO
  itemsPreview: PreviewItem[];
  itemsTotal: number;
  itemsCount: number;
}

/** Output ของ listMastersForUser */
export interface BuyerListOut {
  items: BuyerListRow[];
  total: number;
  page: number;
  limit: number;
}

/* ===== Input types from aggregation ===== */
export type FulfillStatus =
  | "AWAITING_PAYMENT"
  | "PENDING"
  | "PACKED"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELED"
  | "RETURNED";
