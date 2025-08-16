// src/modules/products/types/product-list-item.ts
import { Types } from "mongoose";
import { ProductStatus } from "../dto/create-product.dto";

export interface ProductListItem {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  category: string;
  type: string;
  image?: string;
  defaultPrice?: number;
  status: ProductStatus;
  storeId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  skuCount?: number; // เมื่อ includeSkuCount=1
}
