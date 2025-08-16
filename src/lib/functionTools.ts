// // src/lib/assignIdsToVariants.ts
// import { Types } from "mongoose";
// import { PublicProductVariantDto } from "src/products/dto/public-product-response.dto";
// import { ProductVariant } from "src/products/schemas/product.schema";
// import { PublicStoreResponseDto } from "src/store/dto/public-store-response.dto";

// /**
//  * ใส่ _id ให้กับ variants/sub-variants ทุกระดับ (recursive)
//  * จะสร้างใหม่เฉพาะที่ไม่มี _id
//  */
// export function assignIdsToVariants(variants: ProductVariant[]) {
//   if (!Array.isArray(variants)) return;
//   variants.forEach((v) => {
//     if (!v._id) {
//       v._id = new Types.ObjectId();
//     } else {
//       v._id = new Types.ObjectId(v._id);
//     }
//     if (Array.isArray(v.variants)) assignIdsToVariants(v.variants);
//   });
// }

// /**
//  * update variant in tree (recursive + best practice for Mongoose)
//  * - อัปเดตเฉพาะฟิลด์ที่มีใน update
//  * - ลบฟิลด์ออกถ้าไม่มีใน update (เลือก field ที่ต้องการลบ)
//  * - MUTATE object เดิมเท่านั้น
//  */
// export function updateVariantInTree(
//   tree: ProductVariant[] | undefined,
//   update: ProductVariant,
// ): boolean {
//   if (!Array.isArray(tree) || !update._id) return false;
//   const targetId = update._id.toString();

//   for (let i = 0; i < tree.length; i++) {
//     const node = tree[i];
//     const nodeId = node._id?.toString();

//     if (nodeId === targetId) {
//       // === 1. Mutate field ที่มีใน update ===
//       (
//         ["name", "value", "image", "price", "stock", "variants"] as const
//       ).forEach((k) => {
//         if (update[k] !== undefined) {
//           // @ts-expect-error: dynamic key, safe by runtime type
//           node[k] = update[k];
//         } else {
//           delete node[k];
//         }
//       });

//       // === 2. ลบ field ที่ไม่มีใน update (เลือก field ที่อยากลบ) ===
//       // เช่นถ้า update ไม่ส่ง variants มาเลย จะ remove node.variants ออก
//       // (ถ้าไม่อยากลบ field บางตัว ไม่ต้องลบ)

//       return true;
//     }

//     // === 3. Recursive ลง sub-variants ===
//     if (Array.isArray(node.variants) && node.variants.length > 0) {
//       if (updateVariantInTree(node.variants, update)) return true;
//     }
//   }
//   return false;
// }

// /** ลบ variant ตาม _id (recursive) */
// export function removeVariantInTree(
//   tree: ProductVariant[] = [],
//   targetId: string,
// ): ProductVariant[] {
//   return tree
//     .map((v) => {
//       // ลบใน sub-variant ก่อน (ถ้ามี)
//       const newVariants = v.variants
//         ? removeVariantInTree(v.variants, targetId)
//         : [];
//       // ถ้าตัวนี้เป็น target ให้ return null (จะถูก filter ทิ้งด้านล่าง)
//       if (v._id?.toString() === targetId) return null;

//       // ถ้า sub-variants หมดแล้ว
//       if (!newVariants || newVariants.length === 0) {
//         return {
//           ...v,
//           variants: [],
//           price: 0,
//           stock: 0,
//           image: "",
//         };
//       }
//       // ยังเหลือ sub-variants
//       return {
//         ...v,
//         variants: newVariants,
//       };
//     })
//     .filter(Boolean) as ProductVariant[];
// }

// // 1. Type guard สำหรับ store
// export function isPopulatedStore(
//   store: unknown,
// ): store is PublicStoreResponseDto {
//   return (
//     !!store &&
//     typeof store === "object" &&
//     "name" in store &&
//     "slug" in store &&
//     "_id" in store
//   );
// }

// // 2. Mapper ช่วยแปลง store เป็น DTO
// export function mapStoreToDto(store: any): PublicStoreResponseDto | undefined {
//   if (!isPopulatedStore(store)) return undefined;
//   return {
//     _id: String(store._id),
//     name: store.name,
//     slug: store.slug,
//     logoUrl: store.logoUrl ?? "",
//   };
// }

// export function mapVariantToDto(
//   variant: ProductVariant,
// ): PublicProductVariantDto {
//   return {
//     _id: String(variant._id ?? ""),
//     name: variant.name,
//     value: variant.value,
//     image: variant.image,
//     price: variant.price,
//     stock: variant.stock,
//     variants: Array.isArray(variant.variants)
//       ? variant.variants.map(mapVariantToDto)
//       : [],
//   };
// }
