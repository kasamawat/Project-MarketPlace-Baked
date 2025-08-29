import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { CreateStoreDto } from "./dto/create-store.dto";
import { JwtPayload } from "src/auth/types/jwt-payload.interface";
import { StoreInfoDto } from "./dto/store-info.dto";
import { plainToInstance } from "class-transformer";
import * as jwt from "jsonwebtoken";
import { Store, StoreDocument } from "./schemas/store.schema";
import { Product, ProductDocument } from "src/products/schemas/product.schema";
import { UpdateStoreInfoDto } from "./dto/update-store-info.dto";
import { toSlug } from "./utils/store-function";
import { UpdateStoreBankDto } from "./dto/update-store-bank.dto";

@Injectable()
export class StoreService {
  constructor(
    @InjectModel(Store.name)
    private readonly storeModel: Model<StoreDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
  ) {}

  async createStore(dto: CreateStoreDto, payload: JwtPayload) {
    const store = new this.storeModel({
      ...dto,
      ownerId: payload.userId,
      status: "pending",
      createdAt: new Date(),
    });

    const token = jwt.sign(
      {
        userId: payload.userId,
        username: payload.username,
        email: payload.email,
        storeId: store._id, // <<< สำคัญ!
      },
      process.env.JWT_SECRET!,
      {
        expiresIn: "7d",
      },
    );
    await store.save();

    return token;
  }

  async getStore(payload: JwtPayload) {
    const userId = payload.userId;

    const store = await this.storeModel
      .findOne({ ownerId: userId })
      .select("name status slug") // เพิ่ม slug ถ้า frontend ใช้ redirect ไป /stores/[slug]
      .lean();

    return store;
  }

  async getStoreSecure(payload: JwtPayload): Promise<StoreInfoDto | null> {
    const store = await this.storeModel
      .findOne({ ownerId: payload.userId })
      .lean();

    if (!store) return null;

    return plainToInstance(StoreInfoDto, store, {
      excludeExtraneousValues: true,
    });
  }

  async updateStoreInfo(dto: UpdateStoreInfoDto, payload: JwtPayload) {
    const storeId = new Types.ObjectId(payload.storeId);

    const update: Record<string, any> = {};
    if (dto.name !== undefined) update.name = dto.name.trim();
    if (dto.slug !== undefined) update.slug = toSlug(dto.slug);
    if (dto.description !== undefined) update.description = dto.description;
    if (dto.phone !== undefined) update.phone = dto.phone;
    if (dto.returnPolicy !== undefined) update.returnPolicy = dto.returnPolicy;

    // ถ้าจะเปลี่ยน slug → เช็คซ้ำ
    if (dto.slug !== undefined) {
      const exists = await this.storeModel.exists({
        slug: update.slug,
        _id: { $ne: storeId },
      });
      if (exists) throw new ConflictException("Slug already in use");
    }

    const updated = await this.storeModel
      .findOneAndUpdate(
        { _id: storeId, ownerId: payload.userId }, // กันอัปเดตร้านคนอื่น
        { $set: update },
        { new: true, runValidators: true },
      )
      .lean();

    if (!updated) throw new NotFoundException("Store not found");

    // ถ้ามีฟิลด์ที่ไม่ควรส่งกลับ (เช่น secret) ให้ลบออกก่อน
    return updated;
  }

  async updateStoreBank(dto: UpdateStoreBankDto, playload: JwtPayload) {
    const storeId = new Types.ObjectId(playload.storeId);

    const update: Record<string, any> = {};
    if (dto.bankName !== undefined) update.bankName = dto.bankName.trim();
    if (dto.bankAccountNumber !== undefined)
      update.bankAccountNumber = dto.bankAccountNumber.trim();
    if (dto.bankAccountName !== undefined)
      update.bankAccountName = dto.bankAccountName.trim();

    const updated = await this.storeModel
      .findByIdAndUpdate(
        { _id: storeId, ownerId: playload.userId },
        { $set: update },
        { new: true, runValidators: true },
      )
      .lean();

    if (!updated) {
      throw new NotFoundException("Store not found");
    }

    return updated;
  }

  async assertOwner(userId: string, storeId: string) {
    const userIdObj = new Types.ObjectId(userId);
    const storeIdObj = new Types.ObjectId(storeId);

    const store = await this.storeModel
      .findOne({ ownerId: userIdObj, _id: storeIdObj })
      .lean();

    if (!store) {
      throw new NotFoundException("");
    }

    return true;
  }
}
