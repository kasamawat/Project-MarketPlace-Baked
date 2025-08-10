import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { Product, ProductDocument } from "./product.schema";
import { CreateProductDto } from "./dto/create-product.dto";
import {
  UpdateProductDto,
  UpdateProductVariantDto,
} from "./dto/update-product.dto";
import { JwtPayload } from "src/auth/types/jwt-payload.interface";
import {
  assignIdsToVariants,
  mapStoreToDto,
  mapVariantToDto,
  removeVariantInTree,
  updateVariantInTree,
} from "src/lib/functionTools";
import { PublicProductResponseDto } from "./dto/public-product-response.dto";

@Injectable()
export class ProductService {
  constructor(
    @InjectModel(Product.name) private productModel: Model<ProductDocument>,
  ) {}

  async createProduct(dto: CreateProductDto, payload: JwtPayload) {
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

      assignIdsToVariants(dto.variants);
    }

    const created = new this.productModel({
      ...dto,
      storeId,
    });

    return created.save();
  }

  async findAllProduct(query: Record<string, any>, payload: JwtPayload) {
    const storeId = new Types.ObjectId(payload.storeId);
    // ป้องกัน user แอบค้นร้านอื่น หรือ query storeId ของคนอื่น
    // ลบ storeId ออกจาก query (ถ้ามีจาก frontend)
    if (query.storeId) {
      delete query.storeId;
    }

    // ใส่ storeId จาก token (เสมอ)
    const filter = { ...query, storeId };

    return this.productModel.find(filter).exec();
  }

  async findOneProduct(productId: string) {
    const product = await this.productModel.findById(productId).exec();
    if (!product) throw new NotFoundException("Product not found");
    return product;
  }

  async updateProduct(
    productId: string,
    dto: UpdateProductDto,
    payload: JwtPayload,
  ) {
    // ตรวจสอบสิทธิ์
    const productBefore = await this.productModel.findById(productId);
    if (!productBefore) throw new NotFoundException("Product not found");
    if (productBefore.storeId.toString() !== payload.storeId) {
      throw new ForbiddenException("You cannot edit this product");
    }

    // --- แปลง storeId เป็น ObjectId ถ้ามี ---
    if (dto.storeId && typeof dto.storeId === "string") {
      // เผื่อกรณี update เปลี่ยนร้าน (ถ้าไม่อนุญาตเปลี่ยนร้าน ตัดบรรทัดนี้ออก)
      dto.storeId = new Types.ObjectId(dto.storeId);
    }

    let unsetObj: Record<string, string> = {};

    if (dto.variants && dto.variants.length > 0) {
      assignIdsToVariants(dto.variants); // แปลง _id ของ variants ทุกระดับ
      unsetObj = { image: "", price: "", stock: "" };
    } else {
      unsetObj = { variants: "" };
    }

    const product = await this.productModel.findByIdAndUpdate(
      productId,
      { $set: dto, $unset: unsetObj },
      { new: true },
    );
    if (!product) throw new NotFoundException("Product not found");
    return product;
  }

  async removeProduct(productId: string, payload: JwtPayload) {
    // 1. Find product
    const product = await this.productModel.findById(productId);
    if (!product) throw new NotFoundException("Product not found");

    // 2. Check storeId match payload.storeId yes? or no?
    if (product.storeId.toString() !== payload.storeId) {
      throw new ForbiddenException("You cannot delete this product");
    }

    // 3. Delete product
    return this.productModel.findByIdAndDelete(productId).exec();
  }

  async updateVariant(
    productId: string,
    variantDto: UpdateProductVariantDto,
    payload: JwtPayload,
  ) {
    // Find product from productId and Check permission
    const product = await this.productModel.findById(productId);
    if (!product) throw new NotFoundException("Product not found");
    if (product.storeId.toString() !== payload.storeId) {
      throw new ForbiddenException("You cannot edit this product");
    }

    // ให้แน่ใจว่า variant ที่จะอัพเดท มี _id ถ้าไม่มีให้สร้างใหม่
    if (!variantDto._id) {
      variantDto._id = new Types.ObjectId();
    } else {
      variantDto._id = new Types.ObjectId(variantDto._id);
    }

    // สร้าง _id ให้กับ sub-variants ทุกระดับ
    if (Array.isArray(variantDto.variants)) {
      assignIdsToVariants(variantDto.variants);
    }

    // ===== update (recursive) =====
    if (Array.isArray(product.variants)) {
      const found = updateVariantInTree(product.variants, variantDto);

      if (!found) {
        // ถ้าไม่เจอใน tree เดิม ให้ push เป็น top-level variant
        product.variants.push(variantDto);
      }
    } else {
      product.variants = [variantDto];
    }

    // tell mongo this field have update
    product.markModified("variants");
    await product.save();

    return variantDto;
  }

  async removeVariant(
    productId: string,
    variantId: string,
    payload: JwtPayload,
  ) {
    // Find product and Check permission
    const product = await this.productModel.findById(productId);
    if (!product) throw new NotFoundException("Product not found");
    if (product.storeId.toString() !== payload.storeId?.toString()) {
      throw new ForbiddenException("You cannot edit this product");
    }

    // Delete variant recursive
    product.variants = removeVariantInTree(product.variants ?? [], variantId);

    // *** Check if all variants are removed ***
    if (!product.variants || product.variants.length === 0) {
      product.price = 0;
      product.stock = 0;
      product.image = "";
    }
    // Tell Mongoose this field changed!
    product.markModified("variants");

    await product.save();
    return { success: true };
  }

  async findPublicProducts(): Promise<PublicProductResponseDto[]> {
    const products = await this.productModel
      .find({ status: "published" })
      .populate("storeId", "name slug logoUrl")
      .exec();

    return products.map((product) => ({
      _id: String(product._id),
      name: product.name,
      image: product.image,
      price: product.price,
      category: product.category,
      type: product.type,
      store: mapStoreToDto(product.storeId),
      variants: product.variants?.map(mapVariantToDto) ?? [],
    }));
  }

  async findOnePublished(id: string): Promise<PublicProductResponseDto> {
    const product = await this.productModel
      .findOne({
        _id: id,
        status: "published",
      })
      .exec();

    if (!product) throw new NotFoundException("Product not found");

    return {
      _id: String(product._id),
      name: product.name,
      image: product.image,
      price: product.price,
      category: product.category,
      type: product.type,
      variants: product.variants?.map(mapVariantToDto) ?? [],
    };
  }
}
