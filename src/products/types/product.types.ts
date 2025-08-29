// types/product.types.ts
export interface DeleteProductOptions {
  /** ถ้ามีการอ้างอิงอยู่ (เช่น OrderItem) ให้บังคับลบเลยหรือไม่ */
  force?: boolean;
  /** ตั้งค่า true เพื่อลบแบบ soft (แนะนำถ้ามีประวัติการขาย) */
  soft?: boolean;
}

export interface DeleteProductResult {
  mode: "soft" | "hard";
  productId: string;
  deletedSkus: number;
  deletedProducts: number;
  softUpdatedSkus?: number;
  softUpdatedProducts?: number;
}
