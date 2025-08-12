import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { CreateStoreDto } from "./dto/create-store.dto";
import { JwtPayload } from "src/auth/types/jwt-payload.interface";
import { StoreInfoDto } from "./dto/store-info.dto";
import { plainToInstance } from "class-transformer";
import * as jwt from "jsonwebtoken";
import { PublicStoreResponseDto } from "./dto/public-store-response.dto";
import { PublicProductResponseDto } from "src/products/dto/public-product-response.dto";
import { mapStoreToDto, mapVariantToDto } from "src/lib/functionTools";
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

  async findPublicStores(): Promise<PublicStoreResponseDto[]> {
    const stores = await this.storeModel.find().exec();

    return stores.map((store) => ({
      _id: String(store._id),
      name: store.name,
      slug: store.slug,
      logoUrl: store.logoUrl,
    }));
  }

  async findPublicStore(id: string): Promise<PublicStoreResponseDto> {
    const store = await this.storeModel.findOne({ _id: id }).exec();

    console.log(store, "store");

    if (!store) throw new NotFoundException("Store not found");

    return {
      _id: String(store._id),
      name: store.name,
      slug: store.slug,
      logoUrl: store.logoUrl,
    };
  }

  async findPublicProductByStore(
    id: string,
  ): Promise<PublicProductResponseDto[]> {
    const productsByStore = await this.productModel
      .find({ storeId: id, status: "published" })
      .populate("storeId", "name slug logoUrl")
      .exec();

    return productsByStore.map((product) => ({
      _id: String(product._id),
      name: product.name,
      description: product.description,
      image: product.image,
      price: product.price,
      category: product.category,
      type: product.type,
      store: mapStoreToDto(product.storeId),
      variants: product.variants?.map(mapVariantToDto) ?? [],
    }));
  }
}
