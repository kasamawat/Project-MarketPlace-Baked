import { MasterStatus, StoreStatus } from "../schemas/shared.subdocs";

// --- Types (adjust to your real DTOs) ---
interface BuyerLite {
  _id: string;
  username: string;
  email?: string;
  phone?: string;
}

export interface AddressInfo {
  name?: string;
  phone?: string;
  line1?: string;
  line2?: string;
  district?: string; // อำเภอ/เขต
  subDistrict?: string; // ตำบล/แขวง
  province?: string;
  postalCode?: string;
  country?: string;
  note?: string;
}

interface PaymentInfoLite {
  method: "COD" | "CARD" | "TRANSFER" | "PROMPTPAY" | "WALLET";
  amount: number;
  fee?: number;
  currency?: string; // THB
  paidAt?: string | Date | null;
  intentId?: string; // stripe intent id หรือ reference
  status?: "pending" | "paid" | "failed" | "refunded";
}

interface FulfillTimelineItem {
  type: string;
  at: Date;
  by?: string;
  payload?: Record<string, any>;
}

interface FulfillmentPackageItem {
  productId: string;
  skuId: string;
  qty: number;
  // (optional) snapshot ชื่อ (ช่วยแสดงผลเร็ว)
  attributes?: Record<string, string>;
  productName?: string;
}

interface FulfillmentPackage {
  _id: string;
  code?: string;
  boxType?: string;
  weightKg?: number;
  dimension?: { l?: number; w?: number; h?: number };
  note?: string;
  items: FulfillmentPackageItem[];
  createdAt: Date;

  shipmentId: string;
  shippedAt: string;
}

interface FulfillmentShipment {
  carrier: string; // TH-EMS, TH-KERRY, ...
  trackingNumber: string;
  method?: "DROP_OFF" | "PICKUP";
  shippedAt?: Date;
  packageIds: string[];
  note?: string;
  createdAt: Date;
}

interface FulfillmentInfo {
  status:
    | "UNFULFILLED"
    | "PARTIALLY_FULFILLED"
    | "FULFILLED"
    | "CANCELED"
    | "RETURNED";
  shippedItems?: number;
  deliveredItems?: number;
  totalItems?: number;

  packages: FulfillmentPackage[];
  shipments: FulfillmentShipment[];

  timeline?: FulfillTimelineItem[];

  shipmentId?: string;
  shippedAt?: Date;
}

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

interface StoreOrderItemLite {
  productId: string;
  skuId?: string;
  name: string; // ชื่อสินค้าที่เวลาสั่งซื้อ
  attributes?: Record<string, string>; // ["Color: Red", "Size: L"]
  imageUrl?: string;
  quantity: number;
  price: number; // ราคาต่อชิ้น ณ เวลาสั่ง
  subtotal: number; // price * quantity (หลังส่วนลดของ item)

  packedQty: number;
  shippedQty: number;
  deliveredQty: number;
  canceledQty: number;

  fulfillStatus: "PENDING" | "PACKED" | "SHIPPED" | "DELIVERED" | "CANCELED";
  cover: ImageItemDto;
}

export interface StoreOrderDetail {
  _id: string;
  //code: string; // รหัสคำสั่งซื้อฝั่งร้าน เช่น STO-XXXX
  masterOrderId?: string;
  storeId: string;
  storeStatus: StoreStatus;
  buyerStatus: MasterStatus;
  buyer: BuyerLite;
  shippingAddress?: AddressInfo;
  billingAddress?: AddressInfo;
  itemsPreview: StoreOrderItemLite[];
  discount?: number;
  shippingFee?: number;
  otherFee?: number;
  itemsCount: number;
  itemsTotal: number;
  payment?: PaymentInfoLite;
  fulfillment?: FulfillmentInfo;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoreOrderDetailItem {
  masterOrderId: string;
  storeOrderId: string;
  storeId: string;
  storeStatus: StoreStatus;
  buyerStatus: MasterStatus;
  buyer: BuyerLite;
  shippingAddress?: AddressInfo;
  billingAddress?: AddressInfo;
  itemsPreview: StoreOrderItemLite[];
  discount?: number;
  shippingFee?: number;
  otherFee?: number;
  itemsCount: number;
  itemsTotal: number;
  payment?: PaymentInfoLite;
  fulfillment?: FulfillmentInfo;
  createdAt: string;
  updatedAt: string;
}
