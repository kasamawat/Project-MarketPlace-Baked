/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { ProductDocument } from "src/products/schemas/product.schema";

// search/index-mapper.ts
export type ProductIndexDoc = {
  productId: string;
  storeId: string;
  name: string;
  category: string;
  type: string;
  price: number;
  status: "draft" | "pending" | "published" | "unpublished" | "rejected";

  // cover object
  cover?: { url: string };

  createdAt: string; // ISO
  updatedAt: string; // ISO

  name_auto: string;
  suggest: { input: string[] };

  // optional extras
  rating?: number;
  soldCount?: number;
  brand?: string;
};

type Extras = {
  rating?: number;
  soldCount?: number;
  brand?: string;
};

export function mapProductForIndex(
  p: ProductDocument,
  coverUrl?: string,
  extras: Extras = {},
): ProductIndexDoc & Extras {
  const created =
    (p as any).createdAt instanceof Date ? (p as any).createdAt : new Date();
  const updated =
    (p as any).updatedAt instanceof Date ? (p as any).updatedAt : created;

  const suggestInputs = [p.name, p.category, p.type, extras.brand].filter(
    Boolean,
  ) as string[];

  return {
    productId: String(p._id),
    storeId: String(p.storeId),
    name: p.name,
    category: p.category,
    type: p.type,
    price: p.defaultPrice ?? 0,
    status: p.status as ProductIndexDoc["status"],

    cover: coverUrl ? { url: coverUrl } : undefined,

    createdAt: created.toISOString(),
    updatedAt: updated.toISOString(),

    name_auto: p.name,
    suggest: { input: suggestInputs },

    ...(extras.rating != null ? { rating: extras.rating } : {}),
    ...(extras.soldCount != null ? { soldCount: extras.soldCount } : {}),
    ...(extras.brand ? { brand: extras.brand } : {}),
  };
}
