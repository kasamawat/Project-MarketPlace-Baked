import { Types } from "mongoose";

export type ReleaseMeta = { reason?: string; referenceId?: string };

export type ReservationLean = {
  _id: Types.ObjectId;
  skuId: Types.ObjectId;
  productId: Types.ObjectId;
  storeId: Types.ObjectId;
  qty: number;
  cartId?: string;
  userId?: string;
  expiresAt: Date;
};

export type AggRow = {
  qty: number;
  productId: Types.ObjectId;
  storeId: Types.ObjectId;
};
