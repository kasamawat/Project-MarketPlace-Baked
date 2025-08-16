// skus.service.ts
import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { CreateSkuDto } from "../products/dto/create-product.dto";
import { normalizeAttributes, buildSkuCode } from "src/shared/utils/sku.util";
import { Sku, SkuDocument } from "./schemas/sku-schema";

@Injectable()
export class SkusService {
  constructor(@InjectModel(Sku.name) private skuModel: Model<SkuDocument>) {}

  async prepareForInsert(
    productId: Types.ObjectId,
    productName: string,
    defaultPrice: number | undefined,
    dtos: CreateSkuDto[],
  ) {
    const seen = new Set<string>();
    const rows = dtos.map((d) => {
      // ✅ อนุญาตให้อาจไม่มี attributes หรือเป็น {} ได้ (Base SKU)
      const attrs = d.attributes ?? {};
      const normalized = normalizeAttributes(attrs);

      if (seen.has(normalized))
        throw new ConflictException(
          `Duplicate attributes in payload: ${normalized}`,
        );
      seen.add(normalized);

      return {
        productId,
        attributes: d.attributes,
        normalizedAttributes: normalized,
        skuCode: d.skuCode?.trim() || buildSkuCode(productName, d.attributes),
        price: typeof d.price === "number" ? d.price : (defaultPrice ?? 0),
        image: d.image,
        purchasable: d.purchasable ?? true,
        onHand: 0,
        reserved: 0,
        available: 0,
      };
    });

    // ตรวจสอบชนใน DB (skuCode หรือ normalizedAttributes)
    const codes = rows.map((r) => r.skuCode);
    const norms = rows.map((r) => r.normalizedAttributes);
    const exists = await this.skuModel
      .find({
        $or: [
          { productId, normalizedAttributes: { $in: norms } },
          { skuCode: { $in: codes } },
        ],
      })
      .lean();
    if (exists.length)
      throw new ConflictException("Some SKUs already exist for this product.");

    return rows;
  }

  async guardDeletable(skuId: string, productId: string) {
    const sku = await this.skuModel.findOne({ _id: skuId, productId });
    if (!sku) throw new NotFoundException("SKU not found");
    if (sku.onHand > 0 || sku.reserved > 0) {
      throw new BadRequestException(
        "Cannot delete SKU with onHand or reserved stock.",
      );
    }
    return sku;
  }
}
