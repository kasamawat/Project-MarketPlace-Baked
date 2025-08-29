// products.service.ts
import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { InjectModel, InjectConnection } from "@nestjs/mongoose";
import {
  Model,
  Types,
  Connection,
  UpdateQuery,
  FilterQuery,
  SortOrder,
} from "mongoose";
import { Product, ProductDocument } from "./schemas/product.schema";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { SkusService } from "../skus/skus.service";
import { Sku, SkuDocument } from "src/skus/schemas/sku-schema";
import { JwtPayload } from "src/auth/types/jwt-payload.interface";
import { ListProductsQueryDto } from "./dto/list-products.query";
import { escapeRegExp } from "lodash";
import { ProductListItem } from "./dto/product-list-item";
import {
  ProductDetailResponseDto,
  ProductLeanRaw,
} from "./dto/response-product.dto";
import { SkuLeanRaw, SkuResponseDto } from "./dto/response-skus.dto";
import { SkuBatchSyncDto } from "./dto/sku-batch.dto";
import { normalizeAttributes } from "src/shared/utils/sku.util";
import { plainToInstance } from "class-transformer";
import {
  DeleteProductOptions,
  DeleteProductResult,
} from "./types/product.types";
import {
  StoreOrder,
  StoreOrderDocument,
} from "src/orders/schemas/store-order.schema";

@Injectable()
export class ProductsService {
  constructor(
    @InjectModel(Product.name) private productModel: Model<ProductDocument>,
    private readonly skus: SkusService,
    @InjectModel(Sku.name) private readonly skuModel: Model<SkuDocument>, // ✅ type-safe
    @InjectModel(StoreOrder.name)
    private readonly storeOrderModel: Model<StoreOrderDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async createWithSkus(dto: CreateProductDto, payload: JwtPayload) {
    const storeId = payload.storeId;
    if (!storeId) {
      throw new ForbiddenException("Missing store in token");
    }

    const session = await this.connection.startSession();
    let product!: ProductDocument;

    await session.withTransaction(async () => {
      product = await this.productModel
        .create(
          [
            {
              name: dto.name,
              description: dto.description,
              category: dto.category,
              type: dto.type,
              image: dto.image,
              defaultPrice: dto.defaultPrice,
              storeId: new Types.ObjectId(storeId),
              status: dto.status ?? "draft",
            },
          ],
          { session },
        )
        .then((r) => r[0]);

      const rows = await this.skus.prepareForInsert(
        product._id as Types.ObjectId,
        new Types.ObjectId(storeId),
        product.name,
        product.defaultPrice,
        dto.skus,
      );
      // ใช้ model โดยตรงผ่าน module export
      await this.skuModel.insertMany(rows, { session });
    });

    await session.endSession();
    return { productId: product._id };
  }

  async update(productId: string, dto: UpdateProductDto, payload: JwtPayload) {
    const prod = await this.productModel.findById(productId);
    if (!prod) throw new NotFoundException("Product not found");
    if (String(prod.storeId) !== String(payload.storeId)) {
      throw new ForbiddenException("You cannot edit this product");
    }
    const $set: UpdateQuery<Product>["$set"] = {}; // ✅ typed by Mongoose
    if (dto.name !== undefined) $set.name = dto.name;
    if (dto.description !== undefined) $set.description = dto.description;
    if (dto.category !== undefined) $set.category = dto.category;
    if (dto.type !== undefined) $set.type = dto.type;
    if (dto.image !== undefined) $set.image = dto.image;
    if (dto.defaultPrice !== undefined) $set.defaultPrice = dto.defaultPrice;
    if (dto.status !== undefined) $set.status = dto.status;

    await this.productModel
      .updateOne({ _id: productId }, { $set }, { runValidators: true })
      .exec(); // ใส่ { runValidators: true } ใน updateOne/findOneAndUpdate เสมอ เพื่อให้ schema validator ทำงานตอนอัปเดต

    return this.productModel.findById(productId).lean();
  }

  /** Sync SKUs (create/update/delete) */
  async syncSkus(productId: string, dto: SkuBatchSyncDto, payload: JwtPayload) {
    const prod = await this.productModel.findById(productId).lean();
    if (!prod) throw new NotFoundException("Product not found");
    if (String(prod.storeId) !== String(payload.storeId)) {
      throw new ForbiddenException("You cannot edit this product");
    }

    const create = dto.create ?? [];
    const update = dto.update ?? [];
    const delIds = (dto.delete ?? []).map((id) => new Types.ObjectId(id));

    // เตรียม normalizedAttributes + skuCode
    const createRows = create.map((d) => ({
      productId: new Types.ObjectId(productId),
      storeId: new Types.ObjectId(payload.storeId),
      attributes: d.attributes,
      normalizedAttributes: normalizeAttributes(d.attributes),
      skuCode: d.skuCode?.trim(),
      price: typeof d.price === "number" ? d.price : undefined,
      image: d.image,
      purchasable: d.purchasable ?? true,
    }));

    const updateRows = update.map((d) => ({
      _id: new Types.ObjectId(d._id),
      attributes: d.attributes,
      normalizedAttributes: normalizeAttributes(d.attributes),
      skuCode: d.skuCode?.trim(),
      price: typeof d.price === "number" ? d.price : undefined,
      image: d.image,
      purchasable: d.purchasable ?? true,
    }));

    // ตรวจซ้ำใน payload (normalizedAttributes/skuCode) ระหว่าง create/update เอง
    const seenNorm = new Set<string>();
    const seenCode = new Set<string>();
    for (const row of [...createRows, ...updateRows]) {
      if (seenNorm.has(row.normalizedAttributes)) {
        throw new ConflictException(
          `Duplicate attributes in payload: ${row.normalizedAttributes}`,
        );
      }
      seenNorm.add(row.normalizedAttributes);

      if (row.skuCode) {
        const code = row.skuCode.toUpperCase();
        if (seenCode.has(code))
          throw new ConflictException(`Duplicate skuCode in payload: ${code}`);
        seenCode.add(code);
      }
    }

    // ตรวจซ้ำกับ DB (ชนกับ SKUs อื่น ๆ ใน product เดียวกัน)
    const excludeIds = updateRows.map((u) => u._id);

    const exists = await this.skuModel
      .find({
        productId: new Types.ObjectId(productId),
        $or: [
          { normalizedAttributes: { $in: [...seenNorm] } },
          ...(seenCode.size ? [{ skuCode: { $in: [...seenCode] } }] : []),
        ],
        ...(excludeIds.length ? { _id: { $nin: excludeIds } } : {}),
      })
      .select("_id normalizedAttributes skuCode")
      .lean();

    if (exists.length) {
      throw new ConflictException(
        "Some SKUs already exist or conflict with current payload.",
      );
    }

    // ดำเนินการ: ไม่มี replica set? ใช้ bulkWrite / insertMany แบบไม่มี session
    const writes: any[] = [];

    // create
    if (createRows.length) {
      // ใช้ insertMany แยก เพื่อให้ unique index โยน error ได้ชัดเจน
      await this.skuModel.insertMany(createRows, { ordered: true });
    }

    // update
    for (const u of updateRows) {
      writes.push({
        updateOne: {
          filter: { _id: u._id, productId: new Types.ObjectId(productId) },
          update: {
            $set: {
              attributes: u.attributes,
              normalizedAttributes: u.normalizedAttributes,
              skuCode: u.skuCode,
              price: u.price,
              image: u.image,
              purchasable: u.purchasable,
            },
          },
          upsert: false,
        },
      });
    }

    // delete
    if (delIds.length) {
      writes.push({
        deleteMany: {
          filter: {
            _id: { $in: delIds },
            productId: new Types.ObjectId(productId),
          },
        },
      });
    }

    if (writes.length) {
      await this.skuModel.bulkWrite(writes, { ordered: true });
    }

    // ตอบกลับเป็น SKU ปัจจุบันทั้งหมด
    const after = await this.skuModel
      .find({ productId: new Types.ObjectId(productId) })
      .select("_id skuCode attributes price image purchasable")
      .lean()
      .exec();

    return plainToInstance(SkuResponseDto, after, {
      excludeExtraneousValues: true,
    });
  }

  async deleteProduct(
    productId: string,
    payload: JwtPayload,
    opts: DeleteProductOptions = {},
  ): Promise<DeleteProductResult> {
    const { force = false, soft = false } = opts;

    const productIdObj = new Types.ObjectId(productId);
    const storeIdObj = new Types.ObjectId(payload.storeId);

    // ใช้ session/transaction เพื่อความอะตอมมิก
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        // 1) โหลดสินค้าแบบผูก storeId เพื่อกัน TOCTOU
        const prod = await this.productModel
          .findOne({ _id: productIdObj, storeId: storeIdObj })
          .session(session)
          .lean();

        if (!prod) throw new NotFoundException("Product not found");
        // เผื่อ payload/store ผิดพลาดซ้ำซ้อน
        if (String(prod.storeId) !== String(payload.storeId)) {
          throw new ForbiddenException("You cannot delete this product");
        }

        // 2) ตรวจการอ้างอิงใน storeorders ที่มี items เป็น array
        const hasRefs = await this.storeOrderModel
          .exists({
            storeId: storeIdObj,
            "items.productId": productIdObj,
            status: { $nin: ["CANCELED", "EXPIRED"] },
          })
          .session(session);

        if (!force && !soft && hasRefs) {
          throw new ConflictException(
            `This product is referenced in existing store orders. Use soft delete or set { force: true }.`,
          );
        }

        if (soft) {
          // 3A) SOFT DELETE: ตีธง isDeleted + เก็บ metadata
          const now = new Date();
          const [pRes, sRes] = await Promise.all([
            this.productModel
              .updateOne(
                { _id: productIdObj, storeId: storeIdObj },
                {
                  $set: {
                    isDeleted: true,
                    deletedAt: now,
                    deletedBy: payload.userId,
                    status: "DELETED",
                  },
                },
              )
              .session(session),
            this.skuModel
              .updateMany(
                { productId: productIdObj, storeId: storeIdObj },
                {
                  $set: {
                    isDeleted: true,
                    deletedAt: now,
                    deletedBy: payload.userId,
                  },
                },
              )
              .session(session),
          ]);

          // (ออปชั่น) ยิงอีเวนต์สำหรับระบบอื่น ๆ
          // this.eventBus?.publish?.({
          //   type: "product.soft_deleted",
          //   productId,
          //   storeId: String(storeIdObj),
          //   by: payload.userId,
          //   at: now.toISOString(),
          // });

          return {
            mode: "soft",
            productId,
            deletedSkus: 0,
            deletedProducts: 0,
            softUpdatedProducts: pRes.modifiedCount ?? 0,
            softUpdatedSkus: sRes.modifiedCount ?? 0,
          };
        } else {
          // 3B) HARD DELETE: ลบทั้ง product และ skus
          // (กรณีมี refs และ force=true จะยอมลบ)
          const [pRes, sRes] = await Promise.all([
            this.productModel
              .deleteOne({ _id: productIdObj, storeId: storeIdObj })
              .session(session),
            this.skuModel
              .deleteMany({ productId: productIdObj, storeId: storeIdObj })
              .session(session),
          ]);

          // (ออปชั่น) ยิงอีเวนต์
          // this.eventBus?.publish?.({
          //   type: "product.deleted",
          //   productId,
          //   storeId: String(storeIdObj),
          //   by: payload.userId,
          // });

          return {
            mode: "hard",
            productId,
            deletedProducts: pRes.deletedCount ?? 0,
            deletedSkus: sRes.deletedCount ?? 0,
          };
        }
      });
    } finally {
      await session.endSession();
    }
  }

  async listForStore(
    query: ListProductsQueryDto,
    payload: JwtPayload,
  ): Promise<ProductListItem[]> {
    const storeId = payload.storeId;
    if (!storeId) throw new ForbiddenException("Missing store in token");

    const storeObjectId =
      typeof storeId === "string" ? new Types.ObjectId(storeId) : storeId;

    const filter: FilterQuery<ProductDocument> = { storeId: storeObjectId };
    if (query.q?.trim()) {
      filter.name = { $regex: escapeRegExp(query.q.trim()), $options: "i" };
    }
    if (query.category) filter.category = query.category;
    if (query.type) filter.type = query.type;
    if (query.status) filter.status = query.status;

    const sort: Record<string, SortOrder> =
      query.sort === "oldest"
        ? { updatedAt: "asc" }
        : query.sort === "name_asc"
          ? { name: "asc" }
          : query.sort === "name_desc"
            ? { name: "desc" }
            : { createdAt: "desc" }; // default newest

    // เพจแบบเบา ๆ (ค่าเริ่มต้น limit=100 ถ้าไม่ส่ง page/limit มาก็ยังทำงาน)
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 1000);
    const page = Math.max(query.page ?? 1, 1);
    const skip = (page - 1) * limit;

    // ถ้าต้องการนับจำนวน SKU ต่อชิ้น ให้ใช้ aggregation (ตัวเลือก)
    if (query.includeSkuCount) {
      const pipeline = [
        { $match: filter },
        { $sort: sort },
        { $skip: skip },
        { $limit: limit },
        {
          $lookup: {
            from: "skus",
            localField: "_id",
            foreignField: "productId",
            as: "_skus",
          },
        },
        { $addFields: { skuCount: { $size: "$_skus" } } },
        {
          $project: {
            _skus: 0,
            name: 1,
            description: 1,
            category: 1,
            type: 1,
            image: 1,
            defaultPrice: 1,
            status: 1,
            createdAt: 1,
            updatedAt: 1,
            skuCount: 1,
          },
        },
      ] as const;

      // ✅ ผลลัพธ์มี type แล้ว ไม่ใช่ any[]
      const items: ProductListItem[] = await this.productModel
        .aggregate<ProductListItem>(pipeline as any)
        .exec();

      return items;
    }

    // กรณีทั่วไป: find ธรรมดา (เบาและเร็ว)
    const items = await this.productModel
      .find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .select(
        "_id name description category type image defaultPrice status createdAt updatedAt",
      )
      .lean<ProductListItem[]>()
      .exec();

    return items; // ← array ธรรมดา
  }

  async productByProductId(
    productId: string,
    payload: JwtPayload,
  ): Promise<ProductDetailResponseDto> {
    const storeId = payload.storeId;
    if (!storeId) throw new ForbiddenException("Missing store in token");

    const product = await this.productModel
      .findOne({ _id: productId, storeId: new Types.ObjectId(storeId) })
      .select(
        "_id name description category type image defaultPrice status createdAt updatedAt",
      )
      .lean<ProductLeanRaw>()
      .exec();

    if (!product) throw new NotFoundException("Product not found");

    // ✅ แปลงเป็น string/ISO อย่างชัดเจน ก่อน return
    const res: ProductDetailResponseDto = {
      _id: String(product._id),
      name: product.name,
      description: product.description,
      category: product.category,
      type: product.type,
      image: product.image,
      defaultPrice: product.defaultPrice,
      status: product.status,
      createdAt: new Date(product.createdAt).toISOString(),
      updatedAt: new Date(product.updatedAt).toISOString(),
    };

    return res;
  }

  async listSkusByProductId(
    productId: string,
    payload: JwtPayload,
  ): Promise<SkuResponseDto[]> {
    const storeId = payload.storeId;
    if (!storeId) throw new ForbiddenException("Missing store in token");

    // ตรวจว่าของร้านนี้จริง
    const exists = await this.productModel.exists({
      _id: new Types.ObjectId(productId),
      storeId: new Types.ObjectId(storeId),
    });
    if (!exists) throw new NotFoundException("Product not found");

    const skus = await this.skuModel
      .find({ productId: new Types.ObjectId(productId) })
      .select("_id skuCode attributes price image purchasable onHand reserved")
      .lean<SkuLeanRaw[]>()
      .exec();

    return skus.map((sku) => ({
      _id: String(sku._id), // ✅ แปลง ObjectId → string
      skuCode: sku.skuCode,
      attributes: sku.attributes ?? {},
      price: sku.price,
      image: sku.image,
      purchasable: sku.purchasable ?? true,
      onHand: sku.onHand ?? 0,
      reserved: sku.reserved ?? 0,
      available: Math.max(0, (sku.onHand ?? 0) - (sku.reserved ?? 0)),
    }));
  }
}
