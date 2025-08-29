import { Types } from "mongoose";

export type StoreOrderItemLean = {
  skuId: Types.ObjectId | string;
  productId: Types.ObjectId | string;
  storeId: Types.ObjectId | string;
  quantity: number;
};
