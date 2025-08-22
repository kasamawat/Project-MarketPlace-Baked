import { Types, RootFilterQuery } from "mongoose";
import { SkuDocument } from "src/skus/schemas/sku-schema";

// ---------- 1) กำหนด type สำหรับ $expr ที่เราใช้จริง ----------
type FieldRef<T extends string> = `$${T}`;
type SubtractExpr<A extends string, B extends string> = {
  $subtract: [FieldRef<A>, FieldRef<B>];
};
type GteExpr<E, N extends number> = { $gte: [E, N] };

// เงื่อนไข $expr: (onHand - reserved) >= shortage
type AvailExpr = {
  $expr: GteExpr<SubtractExpr<"onHand", "reserved">, number>;
};

// ---------- 2) เงื่อนไขค้นหาแบบ type-safe ----------
export type SkuCond = RootFilterQuery<SkuDocument> & Partial<AvailExpr>;

// ---------- 3) ชนิดสำหรับ $inc เฉพาะฟิลด์ที่เป็น number ----------
export type IncUpdate = {
  $inc: Partial<Pick<SkuDocument, "onHand" | "reserved">>;
};

// ---------- 4) การสร้าง cond / update โดยไม่ใช้ any ----------
export function buildCommitCondition(
  skuId: Types.ObjectId,
  qty: number,
  shortage: number,
): SkuCond {
  const base: SkuCond = {
    _id: skuId,
    onHand: { $gte: qty },
  };

  if (shortage > 0) {
    return {
      ...base,
      $expr: {
        $gte: [{ $subtract: ["$onHand", "$reserved"] }, shortage],
      },
    };
  }
  return base;
}

export function buildCommitUpdate(
  qty: number,
  reservedCovered: number,
): IncUpdate {
  return {
    $inc: {
      onHand: -qty,
      ...(reservedCovered > 0 ? { reserved: -reservedCovered } : {}),
    },
  };
}
