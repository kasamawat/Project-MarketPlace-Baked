import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { Product, ProductDocument, ProductVariant } from "./product.schema";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { JwtPayload } from "src/auth/types/jwt-payload.interface";
import {
  assignIdsToVariants,
  updateVariantInTree,
} from "src/lib/functionTools";

@Injectable()
export class ProductService {
  constructor(
    @InjectModel(Product.name) private productModel: Model<ProductDocument>,
  ) {}

  async create(dto: CreateProductDto, payload: JwtPayload) {
    const storeId = new Types.ObjectId(payload.storeId);
    if (!storeId) {
      throw new Error("Store ID not found in token");
    }

    // ถ้ามี _id ที่ไม่สมควร ให้ remove ทิ้ง
    if ("_id" in dto && (!dto._id || dto._id === "")) {
      delete dto._id;
    }

    // เคลียร์ field ถ้าเป็นสินค้าที่มี variant
    if (Array.isArray(dto.variants) && dto.variants.length > 0) {
      delete dto.image;
      delete dto.price;
      delete dto.stock;
    }

    const created = new this.productModel({
      ...dto,
      storeId,
    });
    return created.save();
  }

  async findAll(query: Record<string, any>, payload: JwtPayload) {
    const storeId = payload.storeId;
    // ป้องกัน user แอบค้นร้านอื่น หรือ query storeId ของคนอื่น
    // ลบ storeId ออกจาก query (ถ้ามีจาก frontend)
    if (query.storeId) {
      delete query.storeId;
    }

    // ใส่ storeId จาก token (เสมอ)
    const filter = { ...query, storeId };

    return this.productModel.find(filter).exec();
  }

  async findOne(id: string) {
    const product = await this.productModel.findById(id).exec();
    if (!product) throw new NotFoundException("Product not found");
    return product;
  }

  async update(id: string, dto: UpdateProductDto, payload: JwtPayload) {
    // 🔒 ตรวจสอบสิทธิ์ก่อน (ถ้าต้องการ)
    const productBefore = await this.productModel.findById(id);
    if (!productBefore) throw new NotFoundException("Product not found");
    if (productBefore.storeId.toString() !== payload.storeId) {
      throw new ForbiddenException("You cannot edit this product");
    }

    const updateObj: Partial<UpdateProductDto> = { ...dto };
    let unsetObj: Record<string, string> = {};

    if (dto.variants && dto.variants.length > 0) {
      dto.variants.map((v) => {
        v._id = new Types.ObjectId();
      });
      unsetObj = { image: "", price: "", stock: "" };
    } else {
      unsetObj = { variants: "" };
    }

    const product = await this.productModel.findByIdAndUpdate(
      id,
      { $set: updateObj, $unset: unsetObj },
      { new: true },
    );
    if (!product) throw new NotFoundException("Product not found");
    return product;
  }

  async remove(id: string) {
    return this.productModel.findByIdAndDelete(id).exec();
  }

  // src/products/products.service.ts
  async updateVariant(
    productId: string,
    variant: ProductVariant,
    payload: JwtPayload,
  ) {
    // ตรวจสอบสิทธิ์ (ควรตรวจสอบ storeId ใน token)
    const product = await this.productModel.findById(productId);
    if (!product) throw new NotFoundException("Product not found");
    if (product.storeId.toString() !== payload.storeId) {
      throw new ForbiddenException("You cannot edit this product");
    }

    // ให้แน่ใจว่า variant ที่จะอัพเดท มี _id ถ้าไม่มีให้สร้างใหม่
    if (!variant._id) {
      variant._id = new Types.ObjectId();
    }
    // สร้าง _id ให้กับ sub-variants ทุกระดับ
    if (Array.isArray(variant.variants)) {
      assignIdsToVariants(variant.variants);
    }

    // ===== update (recursive) =====
    if (Array.isArray(product.variants)) {
      const found = updateVariantInTree(product.variants, variant);
      if (!found) {
        // ถ้าไม่เจอใน tree เดิม ให้ push เป็น top-level variant
        product.variants.push(variant);
      }
    } else {
      product.variants = [variant];
    }

    await product.save();

    return variant;
  }
}
