// src/orders/types/order-lean.type.ts
import { Types } from "mongoose";
import { OrderStatus } from "../schemas/order.schema";

export type OrderItemLean = {
  productId: Types.ObjectId;
  skuId: Types.ObjectId;
  storeId: Types.ObjectId;
  productName: string;
  productImage?: string;
  attributes: Record<string, string>;
  unitPrice: number;
  quantity: number;
  subtotal: number;
};

export type OrderLean = {
  _id: Types.ObjectId;
  userId?: Types.ObjectId;
  cartId: Types.ObjectId;
  currency: string;
  items: OrderItemLean[];
  itemsCount: number;
  itemsTotal: number;
  status: OrderStatus;
  payment?: {
    provider?: string;
    intentId?: string;
    chargeId?: string;
    status?:
      | "requires_action"
      | "processing"
      | "succeeded"
      | "failed"
      | "canceled";
    amount?: number;
    currency?: string;
  };
  reservationExpiresAt?: Date;
  createdAt: Date; // ต้องประกาศไว้ให้ TS รู้
  updatedAt: Date;
};
