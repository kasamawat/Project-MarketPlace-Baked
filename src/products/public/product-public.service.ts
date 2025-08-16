// src/products/public/product-public.service.ts
import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { FilterQuery, Model, SortOrder, Types } from "mongoose";
import {
  PublicProductListResponseDto,
  PublicProductResponseDto,
} from "./dto/public-product-list.response.dto";
import { Sku, SkuDocument } from "src/skus/schemas/sku-schema";
import { ProductListItem } from "../dto/product-list-item";
import { Product, ProductDocument } from "../schemas/product.schema";
import { PublicProductListQueryDto } from "./dto/public-product-list.query.dto";
import { PublicSkuResponseDto } from "./dto/public-skus-list.response.dto";
import { SkuLeanRaw } from "../dto/response-skus.dto";
import { Store, StoreDocument } from "src/store/schemas/store.schema";
import { StoreLean } from "./helper/store-helper";
import { ProductLeanRaw } from "../dto/response-product.dto";
@Injectable()
export class ProductPublicService {
  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Sku.name) private readonly skuModel: Model<SkuDocument>,
    @InjectModel(Store.name)
    private readonly storeModel: Model<StoreDocument>,
  ) {}

  async findPublicProducts(
    q: PublicProductListQueryDto,
  ): Promise<PublicProductListResponseDto> {
    const page = Math.max(1, q.page ?? 1);
    const limit = Math.min(60, Math.max(1, q.limit ?? 24));
    const skip = (page - 1) * limit;

    const filter: FilterQuery<ProductDocument> = { status: "published" };
    if (q.category) filter.category = q.category;

    // simple search name/description
    if (q.q) {
      const re = new RegExp(q.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ name: re }, { description: re }];
    }

    const sort: Record<string, SortOrder> =
      q.sort === "price_asc"
        ? { defaultPrice: 1, createdAt: -1 }
        : q.sort === "price_desc"
          ? { defaultPrice: -1, createdAt: -1 }
          : /* new */ { updatedAt: -1 };

    const [rows, total] = await Promise.all([
      this.productModel
        .find(filter)
        .select(
          "_id name image description defaultPrice category type storeId updatedAt",
        )
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean<ProductListItem[]>()
        .exec(),
      this.productModel.countDocuments(filter),
    ]);

    // สรุปราคาระดับ SKU (ใช้ราคาของ SKU ถ้ามี; ถ้าไม่มี ใช้ defaultPrice)
    const ids = rows.map((r) => r._id);
    const skus = await this.skuModel
      .find({ productId: { $in: ids }, purchasable: true })
      .select("productId price")
      .lean()
      .exec();

    const priceMap: Record<string, number[]> = {};
    const countMap: Record<string, number> = {};
    for (const p of rows) {
      const id = String(p._id);
      priceMap[id] = [];
      countMap[id] = 0;
    }
    for (const s of skus) {
      const pid = String(s.productId);
      if (pid in priceMap) {
        if (typeof s.price === "number") priceMap[pid].push(s.price);
        countMap[pid] = (countMap[pid] ?? 0) + 1;
      }
    }

    // 1) unique store ids ก่อน
    const storeIdSet = new Set(rows.map((r) => String(r.storeId)));
    const storeIds = Array.from(storeIdSet).map((id) => new Types.ObjectId(id));

    // 2) ดึงร้าน
    const stores = await this.storeModel
      .find({ _id: { $in: storeIds } })
      .select("_id name slug")
      .lean<StoreLean[]>()
      .exec();

    // 3) ทำ map: storeId(string) -> { name, slug }
    const storeMap: Record<
      string,
      { storeId: string; name: string; slug?: string }
    > = {};
    for (const s of stores) {
      storeMap[String(s._id)] = {
        storeId: String(s._id),
        name: s.name,
        slug: s.slug,
      };
    }

    const items: PublicProductResponseDto[] = rows.map((p) => {
      const id = String(p._id);
      const skuPrices = priceMap[id];
      const skuCount = countMap[id] ?? 0;
      // ใช้ defaultPrice เป็น fallback ถ้ายังไม่มีราคาใด ๆ
      const effective = skuPrices.length
        ? skuPrices
        : typeof p.defaultPrice === "number"
          ? [p.defaultPrice]
          : [];

      const priceFrom = effective.length ? Math.min(...effective) : undefined;
      const priceTo = effective.length ? Math.max(...effective) : undefined;

      // ถ้าไม่มี SKUs แต่มี defaultPrice → skuCount ให้เป็น 1 เพื่อสื่อว่า “ซื้อได้ 1 ตัวเลือก”
      const normalizedSkuCount =
        skuCount > 0 ? skuCount : typeof p.defaultPrice === "number" ? 1 : 0;

      return {
        _id: id,
        name: p.name,
        description: p.description,
        image: p.image,
        priceFrom,
        priceTo:
          priceFrom != null && priceTo != null && priceTo !== priceFrom
            ? priceTo
            : undefined,
        skuCount: normalizedSkuCount,
        store: storeMap[String(p.storeId)],
        // storeId: String(p.storeId),
        // (ทางเลือก) เติม store summary หากต้องการ
      };
    });

    return { items, total, page, limit };
  }

  async findProductPublicById(
    productId: string,
  ): Promise<PublicProductResponseDto> {
    // 1) ดึงเฉพาะ published
    const product = await this.productModel
      .findOne({ _id: new Types.ObjectId(productId), status: "published" })
      .select(
        "_id name image description defaultPrice category type storeId updatedAt",
      )
      .lean<ProductLeanRaw>()
      .exec();

    if (!product) throw new NotFoundException("Product not found");

    // 2) ดึง SKUs ที่ซื้อได้ + ข้อมูลร้าน (ชื่อ/slug)
    const [skus, store] = await Promise.all([
      this.skuModel
        .find({ productId: product._id, purchasable: true })
        .select("productId price")
        .lean<SkuLeanRaw[]>()
        .exec(),
      this.storeModel
        .findById(product.storeId)
        .select("_id name slug")
        .lean<StoreLean | null>()
        .exec(),
    ]);

    // 3) สรุปราคา & จำนวนตัวเลือก
    const skuPrices = skus
      .map((s) => s.price)
      .filter((n): n is number => typeof n === "number");

    // ถ้าไม่มีราคาใน SKU เลย ให้ fallback เป็น defaultPrice (ถ้ามี)
    if (!skuPrices.length && typeof product.defaultPrice === "number") {
      skuPrices.push(product.defaultPrice);
    }

    const priceFrom = skuPrices.length ? Math.min(...skuPrices) : undefined;
    let priceTo = skuPrices.length ? Math.max(...skuPrices) : undefined;
    if (priceFrom != null && priceTo === priceFrom) priceTo = undefined;

    // ถ้าไม่มี SKUs แต่มี defaultPrice ให้ถือว่าเลือกได้ 1 ตัวเลือก
    const skuCount =
      skus.length > 0
        ? skus.length
        : typeof product.defaultPrice === "number"
          ? 1
          : 0;

    // 4) map -> DTO
    return {
      _id: product._id.toHexString(),
      name: product.name,
      description: product.description,
      image: product.image,
      priceFrom,
      priceTo,
      skuCount,
      store: store
        ? { storeId: String(store._id), name: store.name, slug: store.slug }
        : undefined,
    };
  }

  async findSkuByProductId(productId: string): Promise<PublicSkuResponseDto[]> {
    const raw = await this.skuModel
      .find({ productId, purchasable: true })
      .select("_id skuCode attributes price image purchasable onHand reserved")
      .lean<SkuLeanRaw[]>()
      .exec();

    const items = raw.map((s) => ({
      _id: String(s._id),
      skuCode: s.skuCode,
      attributes: s.attributes ?? {},
      price: typeof s.price === "number" ? s.price : undefined,
      image: s.image,
      purchasable: s.purchasable !== false,
      available: Math.max(0, (s.onHand ?? 0) - (s.reserved ?? 0)),
      currency: "THB",
    }));

    return items;
  }
}
