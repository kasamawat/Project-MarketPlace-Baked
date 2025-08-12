import { Types } from "mongoose";
import { CreateProductVariantDto } from "src/products/dto/create-product.dto";

// ใช้ path key จาก name+value เพื่อแมตช์ (_id จาก DB เดิม)
export function buildPathKey(name?: string, value?: string) {
  return `${name ?? ""}::${value ?? ""}`.toLowerCase().trim();
}

export function indexOldTreeByPath(
  nodes: CreateProductVariantDto[] | undefined,
  prefix: string = "",
  map = new Map<string, CreateProductVariantDto>(),
) {
  if (!Array.isArray(nodes)) return map;
  for (const n of nodes) {
    const key = prefix
      ? `${prefix}/${buildPathKey(n.name, n.value)}`
      : buildPathKey(n.name, n.value);
    map.set(key, n);
    indexOldTreeByPath(n.variants, key, map);
  }
  return map;
}

export function normalizeIncomingTree(
  nodes: CreateProductVariantDto[] | undefined,
): CreateProductVariantDto[] {
  if (!Array.isArray(nodes)) return [];
  return nodes
    .filter((n) => n && (n.name ?? "").trim() !== "") // ตัดของว่าง
    .map((n) => ({
      _id: n._id, // อาจเป็น "" จาก UI
      name: (n.name ?? "").trim(),
      value: (n.value ?? "").trim(),
      image: n.image ?? "",
      stock: n.stock,
      price: n.price,
      variants: normalizeIncomingTree(n.variants),
    }));
}

// ใส่ _id เดิมกลับเข้าไปถ้าแมตช์ได้ ไม่แมตช์ก็ปล่อยให้เป็น undefined เดี๋ยว Mongo จะสร้างใหม่
export function reuseIdsByContentPath(
  newNodes: CreateProductVariantDto[],
  oldIndex: Map<string, CreateProductVariantDto>,
  prefix: string = "",
): CreateProductVariantDto[] {
  return newNodes.map((n) => {
    const pathKey = prefix
      ? `${prefix}/${buildPathKey(n.name, n.value)}`
      : buildPathKey(n.name, n.value);
    const old = oldIndex.get(pathKey);
    const reusedId = old?._id; // ถ้ามีของเดิม ให้ยืม _id เดิม
    const newId = new Types.ObjectId();
    return {
      ...n,
      _id: reusedId ?? (n._id && n._id.toString() !== "" ? n._id : newId),
      variants: reuseIdsByContentPath(n.variants ?? [], oldIndex, pathKey),
    };
  });
}
