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
import { ImagesLeanRaw, ProductLeanRaw } from "../dto/response-product.dto";
import { Image, ImageDocument } from "src/images/schemas/image.schema";
@Injectable()
export class ProductPublicService {
  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Sku.name) private readonly skuModel: Model<SkuDocument>,
    @InjectModel(Store.name)
    private readonly storeModel: Model<StoreDocument>,
    @InjectModel(Image.name)
    private readonly imageModel: Model<ImageDocument>,
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

    const productIds = rows.map((r) => r._id);
    // สรุปราคาระดับ SKU (ใช้ราคาของ SKU ถ้ามี; ถ้าไม่มี ใช้ defaultPrice)
    const skus = await this.skuModel
      .find({ productId: { $in: productIds }, purchasable: true })
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

    // pull image cover of products
    const images = await this.imageModel
      .find({
        entityId: { $in: productIds },
        storeId: { $in: storeIds },
        entityType: "product",
        role: "cover",
      })
      .select(
        "_id entityId role order publicId version width height format url createdAt",
      )
      .sort({ role: 1, order: 1, createdAt: 1 }) // 'cover' มาก่อน 'gallery', แล้วเรียงตาม order
      .lean<ImagesLeanRaw[]>()
      .exec();

    // ทำ map เร็ว ๆ: productId -> cover
    const coverByProductId = new Map<string, ImagesLeanRaw>();
    for (const img of images) {
      coverByProductId.set(String(img.entityId), img);
    }

    const items: PublicProductResponseDto[] = rows.map((p) => {
      const productId = String(p._id);
      const storeId = String(p.storeId);

      const skuPrices = priceMap[productId];
      const skuCount = countMap[productId] ?? 0;
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

      const imgProdCover = coverByProductId.get(productId);
      const cover = imgProdCover
        ? {
            _id: String(imgProdCover._id),
            role: imgProdCover.role, // เป็น string แน่นอน
            order: imgProdCover.order,
            publicId: imgProdCover.publicId,
            version: imgProdCover.version,
            width: imgProdCover.width,
            height: imgProdCover.height,
            format: imgProdCover.format,
            url: imgProdCover.url,
          }
        : undefined;

      return {
        _id: productId,
        name: p.name,
        description: p.description,
        image: p.image,
        priceFrom,
        priceTo:
          priceFrom != null && priceTo != null && priceTo !== priceFrom
            ? priceTo
            : undefined,
        skuCount: normalizedSkuCount,
        store: storeMap[storeId],
        cover,
        // storeId: String(p.storeId),
        // (ทางเลือก) เติม store summary หากต้องการ
      };
    });

    return { items, total, page, limit };
  }

  async findProductPublicById(
    productId: string,
  ): Promise<PublicProductResponseDto> {
    // 1) product ต้องเป็น published
    const product = await this.productModel
      .findOne({ _id: new Types.ObjectId(productId), status: "published" })
      .select(
        "_id name image description defaultPrice category type storeId updatedAt",
      )
      .lean<ProductLeanRaw>()
      .exec();

    if (!product) throw new NotFoundException("Product not found");

    // 2) ดึง SKUs ที่ซื้อได้ + ข้อมูลร้าน + รูป cover ของสินค้า
    const [skus, store, coverDoc] = await Promise.all([
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
      this.imageModel
        .findOne({
          entityType: "product",
          entityId: product._id,
          role: "cover",
          storeId: new Types.ObjectId(String(product.storeId)),
          // $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
        })
        .select(
          "_id role order publicId version width height format url createdAt",
        )
        .lean<ImagesLeanRaw | null>()
        .exec(),
    ]);

    // 3) คำนวณราคา & จำนวนตัวเลือก
    const skuPrices = skus
      .map((s) => s.price)
      .filter((n): n is number => typeof n === "number");

    if (!skuPrices.length && typeof product.defaultPrice === "number") {
      skuPrices.push(product.defaultPrice);
    }

    const priceFrom = skuPrices.length ? Math.min(...skuPrices) : undefined;
    let priceTo = skuPrices.length ? Math.max(...skuPrices) : undefined;
    if (priceFrom != null && priceTo === priceFrom) priceTo = undefined;

    const skuCount =
      skus.length > 0
        ? skus.length
        : typeof product.defaultPrice === "number"
          ? 1
          : 0;

    // 4) map -> DTO (ถ้าไม่มี cover จะไม่ส่ง field cover)
    const cover = coverDoc
      ? {
          _id: String(coverDoc._id),
          role: coverDoc.role ?? "cover",
          order: typeof coverDoc.order === "number" ? coverDoc.order : 0,
          publicId: coverDoc.publicId ?? "",
          version: coverDoc.version,
          width: coverDoc.width,
          height: coverDoc.height,
          format: coverDoc.format,
          url: coverDoc.url,
        }
      : undefined;

    return {
      _id: String(product._id),
      name: product.name,
      description: product.description,
      image: product.image,
      priceFrom,
      priceTo,
      skuCount,
      store: store
        ? { storeId: String(store._id), name: store.name, slug: store.slug }
        : undefined,
      cover, // optional ถ้าไม่พบ
    };
  }

  async findSkuByProductId(productId: string): Promise<PublicSkuResponseDto[]> {
    const productIdObj = new Types.ObjectId(productId);

    const product = await this.productModel
      .findOne({ _id: productIdObj })
      .select("_id storeId")
      .lean<{ _id: Types.ObjectId; storeId: Types.ObjectId }>()
      .exec();

    const skus = await this.skuModel
      .find({ productId, purchasable: true })
      .select("_id skuCode attributes price image purchasable onHand reserved")
      .lean<SkuLeanRaw[]>()
      .exec();

    const skuIds = skus.map((s) => new Types.ObjectId(s._id));
    const imageDocs = await this.imageModel
      .find({
        entityType: "sku", // หรือ ImageEntityType.Sku
        entityId: { $in: skuIds }, // << สำคัญ: ใช้ $in
        storeId: product?.storeId,
        // $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
      })
      .select(
        "_id entityId role order publicId version width height format url createdAt",
      )
      .sort({ role: 1, order: 1, createdAt: 1 }) // 'cover' มาก่อน
      .lean<ImagesLeanRaw[]>()
      .exec();

    //group follow SKU
    const imagesBySku = new Map<string, ImagesLeanRaw[]>();
    for (const img of imageDocs) {
      const k = String(img.entityId);
      const arr = imagesBySku.get(k) || [];
      arr.push(img);
      imagesBySku.set(k, arr);
    }

    const toImageMini = (d: ImagesLeanRaw) => ({
      _id: String(d._id),
      role: d.role,
      order: d.order ?? 0,
      publicId: d.publicId,
      version: d.version,
      width: d.width,
      height: d.height,
      format: d.format,
      url:
        d.url ??
        `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/f_auto,q_auto/v${d.version}/${d.publicId}`,
    });

    const items = skus.map((sku) => {
      const list = imagesBySku.get(String(sku._id)) ?? [];
      const coverDoc = list.find((x) => x.role === "cover"); // หรือ ImageRole.Cover
      const cover = coverDoc ? toImageMini(coverDoc) : undefined;
      const images = list.map(toImageMini);

      return {
        _id: String(sku._id),
        skuCode: sku.skuCode,
        attributes: sku.attributes ?? {},
        price: typeof sku.price === "number" ? sku.price : undefined,
        image: sku.image,
        purchasable: sku.purchasable !== false,
        available: Math.max(0, (sku.onHand ?? 0) - (sku.reserved ?? 0)),
        currency: "THB",
        cover,
        images,
      };
    });

    return items;
  }
}
