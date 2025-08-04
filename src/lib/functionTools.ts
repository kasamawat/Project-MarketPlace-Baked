// src/lib/assignIdsToVariants.ts
import { Types } from "mongoose";
import { ProductVariant } from "src/products/product.schema";

/**
 * ใส่ _id ให้กับ variants/sub-variants ทุกระดับ (recursive)
 * จะสร้างใหม่เฉพาะที่ไม่มี _id
 */
export function assignIdsToVariants(variants: ProductVariant[]) {
  if (!Array.isArray(variants)) return;
  variants.forEach((v) => {
    if (!v._id) v._id = new Types.ObjectId();
    if (Array.isArray(v.variants)) assignIdsToVariants(v.variants);
  });
}

/**
 * อัปเดท variant ที่อยู่ใน tree (recursively)
 * @param tree   ต้นไม้ของ variants
 * @param update variant ที่ต้องการอัปเดท (ต้องมี _id)
 * @returns true ถ้าเจอและอัปเดทสำเร็จ, false ถ้าไม่เจอ
 */
export function updateVariantInTree(
  tree: ProductVariant[] | undefined,
  update: ProductVariant,
): boolean {
  if (!Array.isArray(tree) || !update._id) return false;

  const targetId = update._id.toString();

  for (let i = 0; i < tree.length; i++) {
    const node = tree[i];
    const nodeId = node._id?.toString();

    if (nodeId === targetId) {
      // merge (อยากเลือก merge แบบ deep/ตื้น เลือกเอา)
      tree[i] = { ...node, ...update };
      return true;
    }

    if (Array.isArray(node.variants) && node.variants.length > 0) {
      // recursion ลง sub-variant
      if (updateVariantInTree(node.variants, update)) {
        return true;
      }
    }
  }
  return false;
}
