import { ApiProperty } from "@nestjs/swagger";
import { MasterStatus, StoreStatus } from "../schemas/shared.subdocs";

export class StoreDetailItemDto {
  @ApiProperty() masterOrderId!: string;
  @ApiProperty() storeOrderId!: string;
  @ApiProperty() storeId!: string;
  @ApiProperty({
    enum: ["PENDING", "PACKED", "SHIPPED", "DELIVERED", "CANCELD", "RETURNED"],
  })
  storeStatus!: StoreStatus;
  @ApiProperty({
    enum: ["pending_payment", "paid", "canceled", "expired", "refunded"],
  })
  buyerStatus!: MasterStatus;
  @ApiProperty({ type: Object }) buyer: {
    _id: string;
    username: string;
    email?: string;
    phone?: string;
  };
  @ApiProperty() shippingAddress?: {
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
  };
  @ApiProperty() billingAddress?: {
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
  };
  @ApiProperty()
  itemsPreview: {
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
  }[];
  @ApiProperty() discount?: number;
  @ApiProperty() shippingFee?: number;
  @ApiProperty() otherFee?: number;
  @ApiProperty() itemsCount: number;
  @ApiProperty() itemsTotal: number;
  @ApiProperty({ type: Object }) payment?: {
    method: "COD" | "CARD" | "TRANSFER" | "PROMPTPAY" | "WALLET";
    amount: number;
    fee?: number;
    currency?: string; // THB
    paidAt?: string | Date | null;
    intentId?: string; // stripe intent id หรือ reference
    status?: "pending" | "paid" | "failed" | "refunded";
  };
  @ApiProperty({ type: Object }) fulfillment?: {
    status:
      | "UNFULFILLED"
      | "PARTIALLY_FULFILLED"
      | "FULFILLED"
      | "CANCELED"
      | "RETURNED";
    shippedItems?: number;
    deliveredItems?: number;
    totalItems?: number;

    packages: {
      _id: string;
      code?: string;
      boxType?: string;
      weightKg?: number;
      dimension?: { l?: number; w?: number; h?: number };
      note?: string;
      items: {
        productId: string;
        skuId: string;
        qty: number;
        // (optional) snapshot ชื่อ (ช่วยแสดงผลเร็ว)
        attributes?: Record<string, string>;
        productName?: string;
      }[];
      createdAt: Date;

      shipmentId: string;
      shippedAt: string;
    }[];
    shipments: {
      carrier: string; // TH-EMS, TH-KERRY, ...
      trackingNumber: string;
      method?: "DROP_OFF" | "PICKUP";
      shippedAt?: Date;
      packageIds: string[];
      note?: string;
      createdAt: Date;
    }[];

    timeline?: {
      type: string;
      at: Date;
      by?: string;
      payload?: Record<string, any>;
    }[];
  };
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
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
