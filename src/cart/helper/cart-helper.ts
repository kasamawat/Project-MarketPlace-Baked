import { Types } from "mongoose";

export type CartItemLean = {
  _id: Types.ObjectId;
  cartId: Types.ObjectId;
  productId: Types.ObjectId;
  skuId: Types.ObjectId;
  storeId: Types.ObjectId;
  productName: string;
  productImage?: string;
  unitPrice: number;
  quantity: number;
  subtotal?: number;
  attributes?: Record<string, string>;
};

export type CartSkuRef = {
  itemId: string;
  skuId: string;
  attributes: Record<string, string>;
  price: number;
  available?: number;
  image?: string;
  purchasable?: boolean;
};

interface CartImageDto {
  _id: string;
  role: string;
  order?: number;
  publicId: string;
  version?: number;
  width?: number;
  height?: number;
  format?: string;
  url?: string;
}

export type CartItemRespone = {
  productId: string;
  productName: string;
  productImage?: string;
  store?: { id?: string; slug?: string; name?: string };
  sku: CartSkuRef;
  quantity: number;
  subtotal: number;
  cover?: CartImageDto;
};
