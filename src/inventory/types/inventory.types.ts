import { Types } from "mongoose";
import { ReservationStatus } from "../schemas/reservation.schema";

export type ReleaseMeta = { reason?: string; referenceId?: string };

export type ReservationLean = {
  _id: Types.ObjectId;
  skuId: Types.ObjectId;
  productId: Types.ObjectId;
  storeId: Types.ObjectId;
  qty: number;
  status: ReservationStatus;
  masterOrderId?: Types.ObjectId;
  cartId?: Types.ObjectId;
  userId?: Types.ObjectId | string;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type AggRow = {
  qty: number;
  productId: Types.ObjectId;
  storeId: Types.ObjectId;
};
