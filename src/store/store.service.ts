import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { CreateStoreDto } from "./dto/create-store.dto";
import { JwtPayload } from "src/auth/types/jwt-payload.interface";
import { StoreInfoDto } from "./dto/store-info.dto";
import { plainToInstance } from "class-transformer";
import * as jwt from "jsonwebtoken";
import { Store, StoreDocument } from "./schemas/store.schema";
import { Product, ProductDocument } from "src/products/schemas/product.schema";

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
    console.log(store, "store");

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
}
