import { Types } from "mongoose";

export type BuyerOrderListItem = {
  masterOrderId: string;
  createdAt: string;
  itemsPreview: {
    name: string;
    qty: number;
    image?: string;
    attributes?: Record<string, string>;
  }[];
  itemsCount: number;
  itemsTotal: number;
  currency: string;
  userStatus: BuyerListStatus;
  reservationExpiresAt?: string;
  storesSummary: storesSummary[];
};

export type BuyerOrderDetail = {
  masterOrderId: string;
  createdAt: string;
  currency: string;
  userStatus: BuyerListStatus;
  reservationExpiresAt?: string;
  payment?: {
    provider?: string;
    method?: string;
    status?: string;
    intentId?: string;
    amount?: number;
    currency?: string;
  };
  pricing?: {
    itemsTotal: number;
    shippingFee: number;
    discountTotal: number;
    taxTotal: number;
    grandTotal: number;
  };
  stores: StoreOrderBriefOut[];
  paidAt: string;
};

export type BuyerListFacet = {
  data: BuyerWithAggRow[];
  total: Array<{ count: number }>;
};

export type storesSummary = {
  storeOrderId: string;
  storeId: string;
  storeName: string;
  storeStatus:
    | "PENDING"
    | "PACKED"
    | "SHIPPED"
    | "DELIVERED"
    | "CANCELED"
    | "RETURNED";
  itemsCount: number;
  itemsTotal: number;
  itemsPreview: {
    name: string;
    qty: number;
    image?: string;
    attributes?: Record<string, string>;
    fulfillStatus?: FulfillStatus;
  }[];
};

export type BuyerWithAggRow = {
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
  status: BuyerListStatus;
  // ต้องมีอย่างน้อย payment.status (optional)
  payment?: {
    status?: PaymentStatus;
  };
  storesSummary: storesSummary[];
};

/* ===== Input types from aggregation ===== */
type FulfillStatus =
  | "AWAITING_PAYMENT"
  | "PENDING"
  | "PACKED"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELED"
  | "RETURNED";

type StoreOrderItemView = {
  productId: string;
  skuId: string;
  productName: string;
  productImage?: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
  fulfillStatus: FulfillStatus;
  attributes?: Record<string, string>;
};

type StoreOrderAgg = {
  _id: Types.ObjectId;
  storeId: Types.ObjectId;
  status: "pending_payment" | "paid" | "expired" | "canceled";
  pricing?: {
    itemsTotal?: number;
    shippingFee?: number;
    discountTotal?: number;
    taxTotal?: number;
    grandTotal?: number;
  };
  items: StoreOrderItemView[];
};

type PaymentStatus =
  | "requires_action"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled";

export type BuyerDetailFacet = {
  _id: Types.ObjectId;
  createdAt: Date;
  currency: string;
  status: "pending_payment" | "paid" | "expired" | "canceled";
  payment?: {
    provider?: string;
    method?: "card" | "promptpay" | "cod";
    status?: PaymentStatus;
    intentId?: string;
    amount?: number;
    currency?: string;
  };
  reservationExpiresAt?: Date;
  pricing?: {
    itemsTotal?: number;
    shippingFee?: number;
    discountTotal?: number;
    taxTotal?: number;
    grandTotal?: number;
  };
  stores: StoreOrderAgg[];
  paidAt: string;
};

/* ===== Output DTO ===== */
type StoreOrderBriefOut = {
  storeOrderId: string;
  storeId: string;
  status: StoreOrderAgg["status"];
  pricing: { itemsTotal: number; grandTotal: number };
  items: StoreOrderItemView[];
};

type BuyerListStatus =
  | "pending_payment"
  | "paying"
  | "processing"
  | "paid"
  | "shipped" // << เพิ่ม
  | "delivered" // << เพิ่ม
  | "expired"
  | "canceled";

export type BuyerOrderDetailItem = {
  masterOrderId: string;
  createdAt: string;
  currency: string;
  userStatus: BuyerListStatus;
  reservationExpiresAt?: string;
  payment?: {
    provider?: string;
    method?: "card" | "promptpay" | "cod";
    status?: PaymentStatus;
    intentId?: string;
    amount?: number;
    currency?: string;
  };
  pricing?: {
    itemsTotal: number;
    shippingFee: number;
    discountTotal: number;
    taxTotal: number;
    grandTotal: number;
  };
  stores: StoreOrderBriefOut[];
  paidAt: string;
};
