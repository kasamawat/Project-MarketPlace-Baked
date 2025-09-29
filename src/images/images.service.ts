// src/images/images.service.ts
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { FilterQuery, Model, Types } from "mongoose";
import { Image, ImageDocument } from "./schemas/image.schema";
import { AttachImageDto } from "./dto/attach-image.dto";
import { SetCoverDto } from "./dto/set-cover.dto";
import { ImageEntityType, ImageRole, ImageStatus } from "./image.enums";
import { JwtPayload } from "src/auth/types/jwt-payload.interface";
import { CloudinaryService } from "src/uploads/uploads.service";
import { Sku, SkuDocument } from "src/skus/schemas/sku-schema";

@Injectable()
export class ImagesService {
  constructor(
    @InjectModel(Image.name) private readonly imageModel: Model<ImageDocument>,
    @InjectModel(Sku.name) private readonly skuModel: Model<SkuDocument>,
    private readonly cloud: CloudinaryService,
  ) {}

  /**
   * แนวทาง updateImage เดิม: เซ็ต/อัปเดตรูป cover ให้ entity หนึ่ง ๆ
   * - สร้างเอกสารใหม่ถ้ายังไม่มี
   * - ย้าย role เดิมที่เป็น cover ให้เป็น gallery
   * - ตั้งค่า order = 0 ของ cover เสมอ
   */
  async setCover(dto: SetCoverDto, user: JwtPayload) {
    const entityFilter = {
      entityType: dto.entityType,
      entityId: new Types.ObjectId(dto.entityId),
      storeId: user.storeId ? new Types.ObjectId(user.storeId) : undefined,
      deletedAt: { $exists: false },
    };

    // ตรวจว่ารูปนี้อยู่ใน entity นี้จริงไหม
    const img = await this.imageModel
      .findOne({ _id: dto.imageId, ...entityFilter })
      .lean();
    if (!img) throw new NotFoundException("Image not found for this entity");

    // ปลด cover เดิม (ถ้ามี)
    await this.imageModel.updateMany(
      { ...entityFilter, role: ImageRole.Cover },
      { $set: { role: ImageRole.Gallery } },
    );

    // ตั้งรูปนี้เป็น cover
    const update = await this.imageModel.findOneAndUpdate(
      { _id: new Types.ObjectId(dto.imageId) },
      { $set: { role: ImageRole.Cover, order: 0, status: ImageStatus.Active } },
      { new: true, lean: true },
    );

    return update;
  }

  /**
   * attach รูปเข้ากับ entity (gallery/cover) – ใช้หลังจาก upload/rename เสร็จ
   * ถ้า role=cover จะ ensure ให้ cover มีได้รูปเดียว
   */
  async attach(dto: AttachImageDto, user: JwtPayload) {
    const entityId = new Types.ObjectId(dto.entityId);

    // --- Authorization & scope ---
    const isUserEntity = dto.entityType === ImageEntityType.User;
    const isLogo = dto.role === ImageRole.Logo;
    const isAvatar = dto.role === ImageRole.Avatar;

    let storeId: Types.ObjectId | undefined = undefined;

    if (isUserEntity) {
      // ผู้ใช้ต้องอัปโหลดให้ "ตัวเอง" เท่านั้น และห้ามอ้าง storeId
      if (!user.userId || entityId.toString() !== String(user.userId)) {
        throw new ForbiddenException("Not allowed for this user");
      }
      storeId = undefined;
    } else {
      // เอนทิตีที่ผูกกับร้าน (store/product/sku/...) ต้องมี storeId และต้องตรงกับ user
      if (!dto.storeId || !user.storeId)
        throw new ForbiddenException("Missing storeId");
      if (String(dto.storeId) !== String(user.storeId)) {
        throw new ForbiddenException("Store scope mismatch");
      }
      storeId = new Types.ObjectId(dto.storeId);
    }

    // --- Active filter (เฉพาะรูปที่ยังไม่ถูกลบ) ---
    const activeFilter: FilterQuery<ImageDocument> = {
      entityType: dto.entityType,
      entityId,
      ...(storeId ? { storeId } : {}),
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
    };

    // 1) ตรวจว่ามีรูป active อยู่แล้วไหม (ใช้กับ rule "first = Cover")
    const hasAny = await this.imageModel.exists(activeFilter);

    // 2) ตัดสิน role สุดท้าย:
    // - Avatar → avatar ตรงๆ
    // - Logo   → logo ตรงๆ
    // - อื่นๆ  → ถ้ายังไม่มีรูปเลย บังคับเป็น Cover, ถ้ามีแล้วใช้ role ตาม dto (Cover/Gallery)
    const finalRole = isAvatar
      ? ImageRole.Avatar
      : isLogo
        ? ImageRole.Logo
        : hasAny
          ? dto.role
          : ImageRole.Cover;

    // 3) เอกลักษณ์ตาม role
    if (finalRole === ImageRole.Avatar) {
      // user profile มี avatar ได้รูปเดียว
      await this.imageModel.deleteMany({
        ...activeFilter,
        role: ImageRole.Avatar,
      });
    } else if (finalRole === ImageRole.Logo) {
      // store logo มีได้รูปเดียว
      await this.imageModel.deleteMany({
        ...activeFilter,
        role: ImageRole.Logo,
      });
    } else if (finalRole === ImageRole.Cover) {
      // ถ้าจะตั้งเป็น Cover ให้ demote Cover เดิมเป็น Gallery
      await this.imageModel.updateMany(
        { ...activeFilter, role: ImageRole.Cover },
        { $set: { role: ImageRole.Gallery } },
      );
    }

    // 4) สร้างเอกสารรูป
    const doc = await this.imageModel.create({
      entityType: dto.entityType,
      entityId,
      role: finalRole,
      order:
        finalRole === ImageRole.Cover ||
        finalRole === ImageRole.Logo ||
        finalRole === ImageRole.Avatar
          ? 0
          : (dto.order ?? 0),
      status: ImageStatus.Active,
      visibility: dto.visibility ?? undefined,
      ...(storeId ? { storeId } : {}),
      createdBy: new Types.ObjectId(user.userId),
      publicId: dto.publicId,
      url: dto.url,
      width: dto.width,
      height: dto.height,
      bytes: dto.bytes,
      format: dto.format,
      version: dto.version,
      etag: dto.etag,
      tags: [],
    });

    return { id: String(doc._id), role: doc.role };
  }

  /**
   * ดึง cover ของ entity
   */
  async getCover(entityType: ImageEntityType, entityId: string) {
    return this.imageModel
      .findOne({
        entityType,
        entityId: new Types.ObjectId(entityId),
        role: ImageRole.Cover,
      })
      .lean();
  }

  /**
   * ดึงแกลเลอรี เรียงตาม order
   */
  async listGallery(entityType: ImageEntityType, entityId: string) {
    return this.imageModel
      .find({
        entityType,
        entityId: new Types.ObjectId(entityId),
        role: ImageRole.Gallery,
        deletedAt: { $exists: false },
      })
      .sort({ order: 1, createdAt: 1 })
      .lean();
  }

  /**
   * เปลี่ยนลำดับ (reorder) แบบ batch
   */
  async reorder(
    entityType: ImageEntityType,
    entityId: string,
    orders: { imageId: string; order: number }[],
    user: JwtPayload,
  ) {
    const eid = new Types.ObjectId(entityId);
    const bulk = this.imageModel.bulkWrite(
      orders.map((o) => ({
        updateOne: {
          filter: {
            _id: new Types.ObjectId(o.imageId),
            entityType,
            entityId: eid,
            storeId: user.storeId
              ? new Types.ObjectId(user.storeId)
              : undefined,
          },
          update: { $set: { order: o.order } },
        },
      })),
    );
    await bulk;
    return { ok: true };
  }

  /**
   * ลบรูป (soft delete) และออปชันลบบน Cloudinary ภายนอก
   */
  async softDelete(imageId: string, user: JwtPayload) {
    if (!user.storeId) throw new ForbiddenException("Missing storeId");

    const _id = new Types.ObjectId(String(imageId));
    const storeObjectId = new Types.ObjectId(String(user.storeId));

    // 1) หาเอกสารรูป (เอา publicId ไปใช้ลบที่ Cloudinary)
    const doc = await this.imageModel
      .findOne({
        _id,
        storeId: storeObjectId,
        $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
      })
      .select("publicId")
      .lean()
      .exec();

    if (!doc) throw new NotFoundException("Image not found");

    // 2) soft-delete ใน DB ก่อน (atomic กว่า)
    await this.imageModel.deleteOne({ _id, storeId: storeObjectId });

    // 3) ลบไฟล์จริงที่ Cloudinary แบบ best-effort + invalidate CDN
    try {
      await this.cloud.destroy(doc.publicId);
    } catch (e) {
      // ไม่ต้อง throw ต่อ เพื่อไม่ให้ API ล้ม — แค่ log ไว้ก็พอ
      console.log(`cloudinary.destroy failed for ${doc.publicId}: ${e}`);
    }

    return { ok: true };
  }

  // images.service.ts
  async deleteProductImages(productId: string, user: JwtPayload) {
    if (!user.storeId) throw new ForbiddenException("Missing storeId");

    const storeIdObj = new Types.ObjectId(user.storeId);
    const productObjId = new Types.ObjectId(productId);

    // 1) ดึง SKU ids ทั้งหมดของ product นี้
    const skuIds: Types.ObjectId[] = await this.skuModel
      .find({ productId: productObjId })
      .select("_id")
      .lean<{ _id: Types.ObjectId }[]>()
      .exec()
      .then((rows) => rows.map((r) => r._id));

    // 2) หา images ของทั้ง product และของทุก SKU (ที่ยังไม่ถูกลบ)
    const images = await this.imageModel
      .find({
        storeId: storeIdObj,
        $or: [
          { entityType: "product", entityId: productObjId },
          ...(skuIds.length
            ? [{ entityType: "sku", entityId: { $in: skuIds } }]
            : []),
        ],
      })
      .select("_id publicId")
      .lean<{ _id: Types.ObjectId; publicId: string }[]>()
      .exec();

    if (!images.length) return { ok: true, deleted: 0 };

    // 3) ลบไฟล์บน Cloudinary (ignore error รายตัว)
    await Promise.all(
      images.map((img) =>
        this.cloud.destroy(img.publicId).catch(() => undefined),
      ),
    );

    // 4) ทำ soft-delete เอกสารรูปใน DB (ถ้าต้องการ hard delete ให้สลับบล็อกด้านล่าง)
    await this.imageModel.deleteMany({
      _id: { $in: images.map((i) => i._id) },
      storeId: storeIdObj,
    });

    // // (ทางเลือก) hard delete:
    // await this.imageModel.deleteMany({ _id: { $in: images.map(i => i._id) }, storeId });

    return { ok: true, deleted: images.length };
  }

  /**
   * ถอด/ลบรูปทั้งหมดของ entity ตาม role ที่กำหนด
   * - ถ้า opts.deleteOnCloud = true จะเรียก cloud.destroy(publicId) แบบ best-effort
   * - ลบใน DB ด้วย deleteMany (ตาม pattern ปัจจุบันของโปรเจกต์)
   */
  async detachByEntityRole(
    entityType: ImageEntityType,
    entityId: string,
    role: ImageRole,
    user: JwtPayload,
    opts?: { deleteOnCloud?: boolean },
  ) {
    const entityObjId = new Types.ObjectId(String(entityId));

    let filter: FilterQuery<ImageDocument> = {
      entityType,
      entityId: entityObjId,
      role,
      // $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
    };

    if (entityType === ImageEntityType.User) {
      if (
        !user.userId ||
        !entityObjId.equals(new Types.ObjectId(String(user.userId)))
      ) {
        throw new ForbiddenException("Not allowed for this user");
      }
    } else {
      if (!user.storeId) throw new ForbiddenException("Missing storeId");
      const storeIdObj = new Types.ObjectId(String(user.storeId));
      filter = { ...filter, storeId: storeIdObj };
    }

    // 1) หา images ที่จะถอด (เลือก _id, publicId พอ)
    const images = await this.imageModel
      .find(filter)
      .select("_id publicId")
      .lean<{ _id: Types.ObjectId; publicId: string }[]>()
      .exec();

    if (!images.length) {
      return { ok: true, deleted: 0 };
    }

    // 2) (ออปชัน) ลบไฟล์บน Cloud แบบ best-effort
    if (opts?.deleteOnCloud) {
      await Promise.all(
        images.map((img) =>
          this.cloud.destroy(img.publicId).catch(() => undefined),
        ),
      );
    }

    // 3) ลบเอกสารรูปใน DB
    const result = await this.imageModel.deleteMany({
      _id: { $in: images.map((i) => i._id) },
    });

    return { ok: true, deleted: result.deletedCount ?? images.length };
  }
}
