import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { FilterQuery, Model, SortOrder, Types } from "mongoose";
import { Product, ProductDocument } from "src/products/schemas/product.schema";
import { Store, StoreDocument } from "../schemas/store.schema";
import { PublicStoreResponseDto } from "./dto/public-store-response.dto";
import { StoreLean } from "src/products/public/helper/store-helper";
import {
  PublicProductListResponseDto,
  PublicProductResponseDto,
} from "src/products/public/dto/public-product-list.response.dto";
import { PublicProductListQueryDto } from "src/products/public/dto/public-product-list.query.dto";
import { ProductListItem } from "src/products/dto/product-list-item";
import { Sku, SkuDocument } from "src/skus/schemas/sku-schema";
import { StoreResolverService } from "../common/store-resolver.service";

@Injectable()
export class StorePublicService {
  constructor(
    @InjectModel(Store.name)
    private readonly storeModel: Model<StoreDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Sku.name) private readonly skuModel: Model<SkuDocument>,
    private readonly storeResolver: StoreResolverService,
  ) {}

  async findPublicStores(): Promise<PublicStoreResponseDto[]> {
    const stores = await this.storeModel.find().exec();

    return stores.map((store) => ({
      _id: String(store._id),
      name: store.name,
      slug: store.slug,
      logoUrl: store.logoUrl,
    }));
  }

  async findPublicStore(idOrSlug: string): Promise<PublicStoreResponseDto> {
    // 1) ลองหาโดย slug ก่อน (แนะนำให้ index/unique ที่ schema)
    const store = await this.storeResolver.getOrThrow(idOrSlug);

    return {
      _id: String(store._id),
      name: store.name,
      slug: String(store.slug),
      logoUrl: store.logoUrl,
    };
  }

  async findPublicProductByStore(
    q: PublicProductListQueryDto,
    idOrSlug: string,
  ): Promise<PublicProductListResponseDto> {
    // 1) ลองหาโดย slug ก่อน (แนะนำให้ index/unique ที่ schema)
    const store = await this.storeResolver.getOrThrow(idOrSlug);

    const page = Math.max(1, q.page ?? 1);
    const limit = Math.min(60, Math.max(1, q.limit ?? 24));
    const skip = (page - 1) * limit;

    const filter: FilterQuery<ProductDocument> = {
      status: "published",
      storeId: store._id,
    };
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
}
