// src/images/image.enums.ts
export enum ImageEntityType {
  Product = "product",
  Sku = "sku",
  User = "user",
  Store = "store",
  Banner = "banner",
}

export enum ImageRole {
  Cover = "cover",
  Gallery = "gallery",
  Avatar = "avatar",
  Logo = "logo",
  Banner = "banner",
}

export enum ImageStatus {
  Temp = "TEMP", // อัปโหลด staging, ยังไม่ commit
  Active = "ACTIVE", // ใช้งานอยู่
  Deleted = "DELETED",
}

export enum ImageVisibility {
  Public = "public",
  Private = "private",
}
