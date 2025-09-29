/* eslint-disable @typescript-eslint/no-base-to-string */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
// products.controller.ts
import {
  BadRequestException,
  Body,
  ClassSerializerInterceptor,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { ProductsService } from "./products.service";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { JwtPayload } from "src/auth/types/jwt-payload.interface";
import { AuthGuard } from "@nestjs/passport";
import { CurrentUser } from "src/common/current-user.decorator";
import { ListProductsQueryDto } from "./dto/list-products.query";
import { isValidObjectId, Model, Types } from "mongoose";
import { plainToInstance } from "class-transformer";
import { ProductDetailResponseDto } from "./dto/response-product.dto";
import { SkuResponseDto } from "./dto/response-skus.dto";
import { SkuBatchSyncDto, SkuImageMeta } from "./dto/sku-batch.dto";
import type { Request, Express } from "express";
import {
  FileFieldsInterceptor,
  FilesInterceptor,
} from "@nestjs/platform-express";
import { validateOrReject } from "class-validator";
import { CloudinaryService } from "src/uploads/uploads.service";
import { memoryStorage } from "multer";
import { ImagesService } from "src/images/images.service";
import { ImageEntityType, ImageRole } from "src/images/image.enums";
import { normalizeAttributes } from "src/shared/utils/sku.util";
import { InjectModel } from "@nestjs/mongoose";
import { Sku, SkuDocument } from "src/skus/schemas/sku-schema";
import { mapProductForIndex } from "src/search/types/index-mapper";
import { OutboxService } from "src/outbox/outbox.service";

@Controller("products")
@UseGuards(AuthGuard("jwt"))
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class ProductsController {
  constructor(
    private readonly svc: ProductsService,
    private readonly cloud: CloudinaryService,
    private readonly imagesService: ImagesService,
    private readonly outboxService: OutboxService,

    @InjectModel(Sku.name) private readonly skuModel: Model<SkuDocument>,
  ) {}

  @Post()
  @UseInterceptors(FilesInterceptor("images", 12, { storage: memoryStorage() }))
  async createProductWithSKUs(
    @CurrentUser() user: JwtPayload,
    @Body("dto") dtoStr: string,
    @Body("coverIndex") coverIndexStr: string | undefined,
    @Body() fallback?: any,
    @UploadedFiles()
    files: Express.Multer.File[] = [],
  ) {
    const raw = dtoStr ? JSON.parse(dtoStr) : fallback;
    const dto = plainToInstance(CreateProductDto, raw);
    await validateOrReject(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    // validate file and up temp
    const MAX = 10 * 1024 * 1024;
    const invalids: string[] = [];
    const temps: {
      idx: number;
      public_id: string;
      version: number;
      width?: number;
      height?: number;
      format?: string;
      bytes?: number;
    }[] = [];

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!f) continue;
      if (!f.mimetype?.startsWith("image/")) {
        invalids.push(`images[${i}] must be an image`);
        continue;
      }
      if (f.size > MAX) {
        invalids.push(`images[${i}] exceeds 10MB`);
        continue;
      }
      const up = await this.cloud.uploadTempImage(
        f.buffer,
        String(user.storeId),
      );
      temps.push({
        idx: i,
        public_id: up.public_id,
        version: up.version,
        width: up.width,
        height: up.height,
        format: up.format,
        bytes: up.bytes,
      });
    }

    if (invalids.length) {
      // ลบ temp ทั้งหมดที่อัปไปแล้วก่อนโยน error
      await Promise.all(
        temps.map((t) => this.cloud.destroy(t.public_id).catch(() => {})),
      );
      throw new BadRequestException(invalids.join("; "));
    }

    try {
      // create product + SKUs
      const product = await this.svc.createProductWithSkus(dto, user);

      // set coverIndex
      const hasImages = temps.length > 0;
      const coverIndex =
        hasImages && coverIndexStr != null && coverIndexStr !== ""
          ? Math.min(
              Math.max(parseInt(coverIndexStr, 10) || 0, 0),
              temps.length - 1,
            )
          : 0;

      let coverUrl: string | undefined;
      // move temp -> path then update db images
      for (const t of temps) {
        const isCover = t.idx === coverIndex;

        const finalId = isCover
          ? `stores/${user.storeId}/products/${String(product._id)}/cover`
          : `stores/${user.storeId}/products/${String(product._id)}/gallery/${t.idx}`;

        await this.cloud.rename(t.public_id, finalId);

        // สร้าง URL ถาวรพร้อม transform + version เพื่อ cache-busting
        const finalUrl = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/f_auto,q_auto/v${t.version}/${finalId}`;

        await this.imagesService.attach(
          {
            entityType: ImageEntityType.Product,
            entityId: String(product._id),
            storeId: String(user.storeId),
            role: ImageRole.Cover,
            publicId: finalId,
            url: finalUrl,
            version: t.version,
            width: t.width,
            height: t.height,
            format: t.format,
            bytes: t.bytes,
          },
          user,
        );

        if (isCover) coverUrl = finalUrl;
      }

      if (!coverUrl) {
        const currentCover = await this.imagesService.getCover(
          ImageEntityType.Product,
          String(product._id),
        );
        coverUrl = currentCover?.url;
      }
      // set payload for index
      if (product.status === "published") {
        const indexPayload = mapProductForIndex(product, coverUrl);
        await this.outboxService.add("search.index.product", indexPayload);
      }

      return { ok: true, id: product._id };
    } catch (e) {
      // rollback: delete all temp if not rename
      await Promise.all(
        temps.map((t) => this.cloud.destroy(t.public_id).catch(() => {})),
      );
      throw e;
    }
  }

  @Put(":productId")
  @UseInterceptors(
    FilesInterceptor(
      "images",
      12,
      { storage: memoryStorage() } /* , { storage: memoryStorage() } */,
    ),
  )
  async updateProduct(
    @Param("productId") id: string,
    @CurrentUser() user: JwtPayload,
    @Body("dto") dtoStr: string | undefined,
    @Body("deleteImageIds") deleteStr?: string,
    @Body("setCoverImageId") setCoverImageId?: string,
    @Body() fallback?: any, // รองรับ JSON ปกติ
    @UploadedFiles()
    files: Express.Multer.File[] = [],
  ) {
    const raw = dtoStr ? JSON.parse(dtoStr) : fallback;
    const dto = plainToInstance(UpdateProductDto, raw);
    await validateOrReject(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    // remove old image
    let deleteIds: string[] = [];
    if (typeof deleteStr === "string" && deleteStr.length) {
      try {
        deleteIds = JSON.parse(deleteStr);
      } catch {
        // ถ้าไม่ใช่ JSON ก็ถือว่าเป็นค่าเดียว
        deleteIds = [deleteStr];
      }
    }

    // upload temp
    const MAX = 10 * 1024 * 1024; // 10MB
    const temps: {
      idx: number;
      public_id: string;
      version: number;
      width?: number;
      height?: number;
      format?: string;
      bytes?: number;
    }[] = [];

    console.log(files, "files");

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!f) continue;
      if (!f.mimetype?.startsWith("image/"))
        throw new BadRequestException(`images[${i}] must be an image`);
      if (f.size > MAX)
        throw new BadRequestException(`images[${i}] exceeds 10MB`);

      const up = await this.cloud.uploadTempImage(
        f.buffer,
        String(user.storeId),
      );
      temps.push({
        idx: i,
        public_id: up.public_id,
        version: up.version,
        width: up.width,
        height: up.height,
        format: up.format,
        bytes: up.bytes,
      });
    }

    try {
      // 3) update filed of product (with out SKUs)
      const product = await this.svc.updateProduct(id, dto, user);

      if (deleteIds.length) {
        const ids = Array.from(new Set(deleteIds.map(String))); // กันซ้ำ
        // ถ้า user เผลอส่งรูปเดียวกันมาเป็น cover ด้วย ให้เคลียร์ไว้ก่อน
        if (setCoverImageId && ids.includes(setCoverImageId)) {
          setCoverImageId = undefined;
        }

        // ยิงขนาน (ignore error รายตัว เผื่อมีรูปที่ลบไปแล้ว)
        await Promise.all(
          ids.map((imgId) =>
            this.imagesService.softDelete(imgId, user).catch(() => undefined),
          ),
        );
      }

      // 4) if have new image -> rename to path + update image cover/gallery
      for (const t of temps) {
        const finalId = `stores/${user.storeId}/products/${id}/gallery/${t.idx}`;

        await this.cloud.rename(t.public_id, finalId);

        const finalUrl =
          `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}` +
          `/image/upload/f_auto,q_auto/v${t.version}/${finalId}`;

        await this.imagesService.attach(
          {
            entityType: ImageEntityType.Product,
            entityId: id,
            storeId: String(user.storeId),
            role: ImageRole.Gallery,
            order: t.idx,
            publicId: finalId,
            url: finalUrl,
            version: t.version,
            width: t.width,
            height: t.height,
            format: t.format,
            bytes: t.bytes,
          },
          user,
        );
      }

      let coverUrl: string | undefined;
      // 7) ตั้ง cover จาก "รูปเดิมใน DB" (ถ้าส่งมา)
      if (setCoverImageId) {
        const currentCover = await this.imagesService.setCover(
          {
            entityType: ImageEntityType.Product,
            entityId: id,
            storeId: String(user.storeId),
            imageId: String(setCoverImageId),
          },
          user,
        );

        coverUrl = currentCover?.url;
      }

      if (!coverUrl) {
        const currentCover = await this.imagesService.getCover(
          ImageEntityType.Product,
          String(product?._id),
        );
        coverUrl = currentCover?.url;
      }
      // set payload for index
      if (product?.status === "published") {
        await this.outboxService.add(
          "search.index.product",
          mapProductForIndex(product, coverUrl),
        );
      } else {
        await this.outboxService.add("search.delete.product", {
          productId: String(product?._id),
        });
      }

      return { ok: true };
    } catch (e) {
      // 5) rollback: delete temp if not rename
      await Promise.all(
        temps.map((t) => this.cloud.destroy(t.public_id).catch(() => {})),
      );
      throw e;
    }
  }

  @Put(":productId/skus/batch")
  @UseInterceptors(
    FileFieldsInterceptor([{ name: "skuImages", maxCount: 100 }], {
      storage: memoryStorage(),
    }),
  )
  async updateSkusWithImages(
    @CurrentUser() user: JwtPayload,
    @Param("productId") id: string,
    @Body("dto") dtoStr?: string,
    @Body("skuImagesMeta") metaStr?: string,
    @Body("skuDeleteImageIds") delImgStr?: string,
    @UploadedFiles()
    files?: { skuImages?: Express.Multer.File[] },
    // @Body() dto: SkuBatchSyncDto,
  ) {
    // 1) parse meta
    type SkuImageMeta = { uid: string; key?: string; skuId?: string };
    let metas: SkuImageMeta[] = [];
    if (metaStr) {
      try {
        metas = JSON.parse(metaStr);
      } catch {
        throw new BadRequestException("Invalid skuImagesMeta");
      }
    }
    const metaByUid = new Map(metas.map((m) => [m.uid, m]));

    // 2) parse delete image ids
    let deleteIds: string[] = [];
    if (typeof delImgStr === "string" && delImgStr.length) {
      try {
        const arr = JSON.parse(delImgStr);
        if (Array.isArray(arr))
          deleteIds = Array.from(new Set(arr.map(String)));
      } catch {
        /* ignore */
      }
    }
    // 3) upload temp
    const MAX = 10 * 1024 * 1024;
    const inputFiles = files?.skuImages ?? [];
    const temps: {
      public_id: string;
      version: number;
      width?: number;
      height?: number;
      format?: string;
      bytes?: number;
      meta?: SkuImageMeta;
    }[] = [];

    for (const f of inputFiles) {
      if (!f) continue;
      if (!f.mimetype?.startsWith("image/")) {
        throw new BadRequestException(`skuImages must be an image`);
      }
      if (f.size > MAX) {
        throw new BadRequestException(`skuImages exceeds 10MB`);
      }
      const up = await this.cloud.uploadTempImage(
        f.buffer,
        String(user.storeId),
      );
      const base = f.originalname.replace(/\.[^.]+$/, ""); // ตัดนามสกุล
      const uidMatch = base.match(/^uid_(.+)$/);
      const uid = uidMatch?.[1];

      const meta = uid ? metaByUid.get(uid) : undefined;
      temps.push({
        public_id: up.public_id,
        version: up.version,
        width: up.width,
        height: up.height,
        format: up.format,
        bytes: up.bytes,
        meta,
      });
    }

    try {
      // 4) ถ้ามี dto ให้ syncSkus, ถ้าไม่มีให้ดึง SKUs ปัจจุบันมาแมป
      let after: Array<{ _id: any; attributes: Record<string, string> }>;
      if (dtoStr) {
        const dto: SkuBatchSyncDto = JSON.parse(dtoStr);
        after = await this.svc.syncSkus(id, dto, user); // ควรคืน SkuResponseDto[]
      } else {
        after = await this.skuModel
          .find({ productId: new Types.ObjectId(id) })
          .select("_id attributes")
          .lean()
          .exec();
      }

      // 5) ลบรูปเดิมของ SKU ถ้ามีคำสั่งมา
      if (deleteIds.length) {
        await Promise.all(
          deleteIds.map((imgId) =>
            this.imagesService.softDelete(imgId, user).catch(() => undefined),
          ),
        );
      }

      // 6) map key → skuId จากรายชื่อ after
      const byId = new Map(after.map((s) => [s._id, s]));
      const byKey = new Map(
        after.map((s) => [
          normalizeAttributes(s.attributes ?? {}), // ใช้ util ฝั่ง BE เดิม
          s,
        ]),
      );

      // 7) แนบรูปต่อ SKU (cover ของ SKU)
      // 7) ประมวลผลรูปทั้งหมด (อย่า return ในลูป)
      for (const t of temps) {
        const meta = t.meta;
        if (!meta) {
          await this.cloud.destroy(t.public_id).catch(() => {});
          continue;
        }

        let skuId: string | undefined;
        if (meta.skuId && byId.has(meta.skuId)) {
          skuId = meta.skuId;
        } else if (meta.key && byKey.has(meta.key)) {
          skuId = String(byKey.get(meta.key)!._id);
        }

        if (!skuId) {
          await this.cloud.destroy(t.public_id).catch(() => {});
          continue;
        }

        const finalId = `stores/${user.storeId}/products/${id}/skus/${skuId}/cover`;
        await this.cloud.rename(t.public_id, finalId);

        const finalUrl =
          `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}` +
          `/image/upload/f_auto,q_auto/v${t.version}/${finalId}`;

        // แนบเป็น gallery ก่อน (กัน unique index ชน)
        const created = await this.imagesService.attach(
          {
            entityType: ImageEntityType.Sku,
            entityId: skuId,
            storeId: String(user.storeId),
            role: ImageRole.Gallery,
            order: 0,
            publicId: finalId,
            url: finalUrl,
            version: t.version,
            width: t.width,
            height: t.height,
            format: t.format,
            bytes: t.bytes,
          },
          user,
        );

        // promote เป็น cover (service จะ demote cover เดิมเอง)
        await this.imagesService.setCover(
          {
            entityType: ImageEntityType.Sku,
            entityId: skuId,
            storeId: String(user.storeId),
            imageId: String(created.id),
          },
          user,
        );
      }
    } catch (e) {
      // rollback temp ที่ยังไม่ได้ rename
      await Promise.all(
        temps.map((t) => this.cloud.destroy(t.public_id).catch(() => {})),
      );
      throw e;
    }
  }

  @Delete(":productId")
  async deleteProduct(
    @Param("productId") productId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.imagesService.deleteProductImages(productId, user); // ✅ ลบรูป (product+sku)
    await this.svc.deleteProduct(productId, user); // ✅ ลบตัว product (+ sku ถ้ามี)

    return { ok: true };
  }

  @Get()
  getProductList(
    @Query() query: ListProductsQueryDto,
    @CurrentUser() req: JwtPayload,
  ) {
    return this.svc.listForStore(query, req);
  }

  @Get(":productId")
  @UseInterceptors(ClassSerializerInterceptor)
  async getProductByProductId(
    @Param("productId") productId: string,
    @CurrentUser() req: JwtPayload,
  ) {
    if (!isValidObjectId(productId)) {
      throw new BadRequestException("Invalid productId");
    }

    const doc = await this.svc.productByProductId(productId, req);

    return plainToInstance(ProductDetailResponseDto, doc, {
      excludeExtraneousValues: true,
    });
  }

  @Get(":productId/skus")
  @UseInterceptors(ClassSerializerInterceptor)
  async getSkusListByProductId(
    @Param("productId") productId: string,
    @CurrentUser() req: JwtPayload,
  ) {
    if (!isValidObjectId(productId))
      throw new BadRequestException("Invalid productId");

    const doc = await this.svc.listSkusByProductId(productId, req);
    return plainToInstance(SkuResponseDto, doc, {
      excludeExtraneousValues: true,
    });
  }
}
