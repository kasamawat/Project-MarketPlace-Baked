// src/search/index.types.ts
export interface ProductIndexEvent {
  // keys หลัก
  productId: string;
  storeId: string;

  // สำหรับค้น/เรียง/แสดงลิสต์
  name: string;
  category: string;
  type: string;
  price: number;

  // optional extras
  brand?: string;
  rating?: number;
  soldCount?: number;

  // cover object (ให้ FE ใช้ตรง ๆ)
  cover?: { url: string };

  // timestamps (ช่วยเรื่องความสด/ดีบั๊ก)
  createdAt?: string; // ISO
  updatedAt?: string; // ISO

  // (ออปชันเผื่อ safety) สถานะ ณ ตอนส่ง event
  status?: "draft" | "pending" | "published" | "unpublished" | "rejected";
}

export interface StoreIndexEvent {
  storeId: string;
  name: string;
  bannerUrl?: string;
  province?: string;
  rating?: number;
  follower?: number;
  createdAt?: string;
}
