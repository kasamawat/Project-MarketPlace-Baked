import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectConnection, InjectModel } from "@nestjs/mongoose";
import { ClientSession, Connection, Model, Types } from "mongoose";
import { Product, ProductDocument } from "src/products/schemas/product.schema";
import { Sku, SkuDocument } from "src/skus/schemas/sku-schema";
import { CartItem, CartItemDocument } from "./schemas/cart-item.schema";
import { Cart, CartDocument } from "./schemas/cart.schema";
import { AddCartItemDto } from "./dto/add-cart-item.dto";
import { CartResponseDto } from "./dto/cart.response.dto";
import { computeAvailable } from "./utils/cart-function";
import { CartResolverService } from "./common/cart-resolver.service";
import { UpdateCartQtyDto } from "./dto/update-cart-qty.dto";
import { Store, StoreDocument } from "src/store/schemas/store.schema";
import { CartItemLean, CartItemRespone } from "./helper/cart-helper";
import { StoreLean } from "src/products/public/helper/store-helper";
import { SkuLeanRaw } from "src/products/dto/response-skus.dto";
import { ImagesLeanRaw } from "src/products/dto/response-product.dto";
import { Image, ImageDocument } from "src/images/schemas/image.schema";

const CART_COOKIE = "cartId";
const CART_TTL_MIN = 7 * 24 * 60; // 7 วัน

@Injectable()
export class CartService {
  constructor(
    @InjectModel(Cart.name) private readonly cartModel: Model<CartDocument>,
    @InjectModel(CartItem.name)
    private readonly cartItemModel: Model<CartItemDocument>,
    @InjectModel(Sku.name) private readonly skuModel: Model<SkuDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectConnection() private readonly conn: Connection,
    private readonly cartResolverService: CartResolverService,
    @InjectModel(Store.name) private readonly storeModel: Model<StoreDocument>,
    @InjectModel(Image.name) private readonly imageModel: Model<ImageDocument>,
  ) {}

  async getOrCreateCart(opts: {
    userId?: string;
    cartKey?: string;
    setCookie?: (key: string, val: string, maxAgeSec: number) => void;
  }) {
    const now = Date.now();

    // 1. user
    if (opts.userId) {
      const uid = new Types.ObjectId(opts.userId);
      let cart = await this.cartModel
        .findOne({ userId: uid, status: "open" })
        .exec();
      if (!cart) {
        cart = await this.cartModel.create({
          userId: uid,
          status: "open",
          itemsCount: 0,
          itemsTotal: 0,
          currency: "THB",
        });
      }
      return cart;
    }

    // 2. guest: use cartKey cookie
    let key = opts.cartKey ?? null;
    if (key) {
      const cart = await this.cartModel
        .findOne({
          cartKey: key,
          status: "open",
        })
        .exec();
      if (cart) return cart;
    }

    // 3. create new cart + set cookie
    key = crypto.randomUUID();
    const expiresAt = new Date(now + CART_TTL_MIN * 60_000);
    const cart = await this.cartModel.create({
      cartKey: key,
      status: "open",
      itemsCount: 0,
      itemsTotal: 0,
      currency: "THB",
      expiresAt,
    });

    if (opts.setCookie) {
      opts.setCookie(CART_COOKIE, key, CART_TTL_MIN * 60);
    }
    return cart;
  }

  async getCartItems(
    cartId: string,
    opts: {
      expandStore?: boolean;
      withAvailability?: boolean;
      session?: ClientSession;
    } = {},
  ): Promise<CartItemRespone[]> {
    const cartIdObj = new Types.ObjectId(cartId);
    const cart = await this.cartModel.findById(cartIdObj).lean().exec();
    if (!cart) throw new NotFoundException("Cart not found");

    // รายการในตะกร้า
    const cartItems = await this.cartItemModel
      .find({ cartId: cartIdObj })
      .session(opts.session ?? null)
      .select(
        "_id cartId productId skuId storeId productName productImage unitPrice quantity subtotal attributes",
      )
      .lean<CartItemLean[]>()
      .exec();

    if (!cartItems.length) return [];

    // ===== stores (optional) =====
    const storeIds = Array.from(
      new Set(cartItems.map((r) => String(r.storeId))),
    ).map((id) => new Types.ObjectId(id));

    let storeMap: Record<string, { name?: string; slug?: string }> = {};
    if (opts.expandStore) {
      const stores = await this.storeModel
        .find({ _id: { $in: storeIds } })
        .select("_id name slug")
        .lean<StoreLean[]>()
        .exec();
      storeMap = Object.fromEntries(
        stores.map((s) => [String(s._id), { name: s.name, slug: s.slug }]),
      );
    }

    // ===== availability (optional) =====
    const skuIds = cartItems.map((r) => r.skuId);
    let skuExtraMap: Record<
      string,
      { available?: number; purchasable?: boolean; image?: string }
    > = {};
    if (opts.withAvailability) {
      const skus = await this.skuModel
        .find({ _id: { $in: skuIds } })
        .select("_id onHand reserved purchasable image")
        .lean<SkuLeanRaw[]>()
        .exec();
      skuExtraMap = Object.fromEntries(
        skus.map((s) => [
          String(s._id),
          {
            available: Math.max(0, (s.onHand ?? 0) - (s.reserved ?? 0)),
            purchasable: s.purchasable,
            image: s.image, // legacy/fallback
          },
        ]),
      );
    }

    // ===== ภาพ: SKU cover (ถ้ามี) → ถ้าไม่มีใช้ Product cover =====
    const productIds = Array.from(
      new Set(cartItems.map((r) => String(r.productId))),
    ).map((id) => new Types.ObjectId(id));

    const imageDocs = await this.imageModel
      .find({
        // ขอทั้งรูปของ sku และ product ในคำสั่งเดียว
        $or: [
          { entityType: "sku", entityId: { $in: skuIds } },
          { entityType: "product", entityId: { $in: productIds } },
        ],
        // จำกัดให้อยู่ในร้านที่เกี่ยวข้อง (ถ้าคุณต้องการ include รูป global ให้เพิ่ม $or กับ !storeId ได้)
      })
      .select(
        "_id entityType entityId role order publicId version width height format url createdAt",
      )
      .sort({ role: 1, order: 1, createdAt: 1 }) // ให้ cover มาก่อน
      .lean<ImagesLeanRaw[]>()
      .exec();

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

    // สร้าง map: skuId -> รูป (เอา cover ก่อน ถ้าไม่มี cover ก็เอาอันแรก)
    const skuCoverMap = new Map<string, ReturnType<typeof toImageMini>>();
    // สร้าง map: productId -> รูป cover (หรืออันแรก)
    const prodCoverMap = new Map<string, ReturnType<typeof toImageMini>>();

    for (const d of imageDocs) {
      const mini = toImageMini(d);
      const entId = String(d.entityId);
      if (d.entityType === "sku") {
        // ถ้ายังไม่มีให้ตั้งอันแรกไว้ก่อน แล้วถ้าเจอ cover ค่อยทับ
        if (!skuCoverMap.has(entId)) skuCoverMap.set(entId, mini);
        if (d.role === "cover") skuCoverMap.set(entId, mini);
      } else if (d.entityType === "product") {
        if (!prodCoverMap.has(entId)) prodCoverMap.set(entId, mini);
        if (d.role === "cover") prodCoverMap.set(entId, mini);
      }
    }

    // ===== map → response =====
    return cartItems.map((it): CartItemRespone => {
      const sid = String(it.storeId);
      const kid = String(it.skuId);
      const pid = String(it.productId);
      const unitPrice = it.unitPrice ?? 0;
      const qty = it.quantity ?? 1;

      // เลือกรูป: SKU cover → SKU.image (legacy) → Product cover → productImage (legacy)
      const skuCover = skuCoverMap.get(kid);
      const prodCover = prodCoverMap.get(pid);

      const finalImageUrl =
        skuCover?.url ??
        skuExtraMap[kid]?.image ??
        prodCover?.url ??
        it.productImage;

      // (ถ้าต้องการคืน cover object ใน payload ด้วย)
      const cover = skuCover ?? prodCover;

      return {
        productId: pid,
        productName: it.productName,
        productImage: finalImageUrl, // ใส่เป็นรูปสุดท้ายที่เลือกแล้ว
        store: { id: sid, ...storeMap[sid] },
        sku: {
          itemId: String(it._id),
          skuId: kid,
          attributes: it.attributes ?? {},
          price: unitPrice,
          available: skuExtraMap[kid]?.available,
          image: finalImageUrl, // ให้ฝั่ง SKU ก็อ้างอิงภาพเดียวกัน
          purchasable: skuExtraMap[kid]?.purchasable,
        },
        quantity: qty,
        subtotal: unitPrice * qty,
        cover, // ถ้า type ของ CartItemRespone รองรับ object cover
      };
    });
  }

  async upsertCartItem(
    cartId: string,
    dto: AddCartItemDto,
  ): Promise<CartResponseDto> {
    const cartIdObj = new Types.ObjectId(cartId);
    const cart = await this.cartModel.findById(cartIdObj).lean().exec();
    if (!cart) {
      throw new NotFoundException("Cart not found");
    }

    const session = await this.conn.startSession();
    try {
      let result!: CartResponseDto;

      await session.withTransaction(async () => {
        const sku = await this.skuModel
          .findById(dto.skuId)
          .session(session)
          .lean()
          .exec();
        if (!sku) {
          throw new NotFoundException("SKU not found");
        }
        if (sku.purchasable === false) {
          throw new NotFoundException("SKU is not purchasable");
        }

        const available = computeAvailable(sku.onHand, sku.reserved);
        if (available <= 0) {
          throw new NotFoundException("SKU is out of stock");
        }

        const product = await this.productModel
          .findById(sku.productId)
          .select("_id name image defaultPrice storeId")
          .session(session)
          .lean()
          .exec();
        if (!product) {
          throw new NotFoundException("Product not found");
        }

        const unitPrice =
          typeof sku.price === "number"
            ? sku.price
            : typeof product.defaultPrice === "number"
              ? product.defaultPrice
              : 0;

        const existing = await this.cartItemModel
          .findOne({ cartId: cart?._id, skuId: sku._id })
          .session(session)
          .exec();

        if (existing) {
          const nextQty = Math.max(
            1,
            Math.min(existing.quantity + dto.qty, available),
          );
          existing.quantity = nextQty;
          existing.unitPrice = unitPrice; // อัปเดตราคา snapshot
          existing.subtotal = nextQty * unitPrice;
          await existing.save({ session });
        } else {
          const initQty = Math.max(1, Math.min(dto.qty, available));
          await this.cartItemModel.create(
            [
              {
                cartId: cart?._id,
                productId: product._id,
                skuId: sku._id,
                storeId: product.storeId,
                unitPrice,
                quantity: initQty,
                subtotal: initQty * unitPrice,
                productName: product.name,
                productImage: product.image,
                attributes: sku.attributes ?? {},
              },
            ],
            { session },
          );
        }

        const { itemsCount, itemsTotal } =
          await this.cartResolverService.recalcTotals(cartIdObj, session);
        const items = await this.cartItemModel
          .find({ cartId: cart?._id })
          .lean()
          .session(session)
          .exec();

        result = {
          cartId: String(cart?._id),
          itemsCount,
          itemsTotal,
          currency: cart?.currency ?? "THB",
          items: items.map((it) => ({
            _id: String(it._id),
            productId: String(it.productId),
            skuId: String(it.skuId),
            storeId: String(it.storeId),
            productName: it.productName,
            productImage: it.productImage,
            unitPrice: it.unitPrice,
            quantity: it.quantity,
            subtotal: it.subtotal,
            attributes: it.attributes ?? {},
          })),
        };
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  async updateQty(
    cartId: string,
    itemId: string,
    dto: UpdateCartQtyDto,
  ): Promise<CartItemRespone[]> {
    const cartIdObj = new Types.ObjectId(cartId);
    const cart = await this.cartModel.findById(cartIdObj).lean().exec();
    if (!cart) {
      throw new NotFoundException("Cart not found");
    }

    const item = await this.cartItemModel
      .findOne({ _id: itemId, cartId: cart._id })
      .exec();
    if (!item) {
      throw new NotFoundException("Cart item not found");
    }

    const sku = await this.skuModel.findById(item.skuId).lean().exec();
    if (!sku) {
      throw new NotFoundException("SKU not found");
    }

    const available = computeAvailable(sku.onHand, sku.reserved);
    const q = Math.max(1, Math.min(dto.qty, available));
    item.quantity = q;
    item.subtotal = q * (item.unitPrice ?? 0);
    await item.save();

    return this.getCartItems(String(cart._id), {
      expandStore: true,
      withAvailability: true,
    });
  }

  async removeItem(cartId: string, itemId: string): Promise<CartItemRespone[]> {
    if (!Types.ObjectId.isValid(cartId) || !Types.ObjectId.isValid(itemId)) {
      throw new BadRequestException("Invalid id");
    }
    const cartIdObj = new Types.ObjectId(cartId);
    const itemIdObj = new Types.ObjectId(itemId);

    const session = await this.conn.startSession();
    try {
      let items!: CartItemRespone[];

      await session.withTransaction(async () => {
        const cart = await this.cartModel
          .findById(cartIdObj)
          .session(session)
          .lean()
          .exec();
        if (!cart) throw new NotFoundException("Cart not found");

        const del = await this.cartItemModel
          .deleteOne({ _id: itemIdObj, cartId: cartIdObj })
          .session(session)
          .exec();
        if (del.deletedCount === 0) {
          throw new NotFoundException("Cart item not found");
        }

        // ⬇️ อัปเดตยอดรวมใน carts ให้ตรง (อยู่ใน tx เดียวกัน)
        await this.cartResolverService.recalcTotals(cartIdObj, session);

        // ⬇️ คืนรายการล่าสุดให้ FE (ถ้าต้องการ summary ด้วยจะเรียก getCart แทน)
        items = await this.getCartItems(cartId, {
          expandStore: true,
          withAvailability: true,
          session, // ปล่อยให้อ่านใน session เดียวกันเพื่อเห็นค่าทันที
        });
      });

      return items;
    } finally {
      await session.endSession();
    }
  }

  async clearCart(cartId: string): Promise<CartItemRespone[]> {
    if (!Types.ObjectId.isValid(cartId)) {
      throw new BadRequestException("Invalid cart id");
    }
    const cartIdObj = new Types.ObjectId(cartId);

    const session = await this.conn.startSession();
    try {
      let itemsAfter: CartItemRespone[] = [];

      await session.withTransaction(async () => {
        const cart = await this.cartModel
          .findById(cartIdObj)
          .session(session)
          .lean()
          .exec();
        if (!cart) throw new NotFoundException("Cart not found");

        // (ถ้าคุณมีระบบ reserve: ดึง items แล้ว release ก่อน)
        // const items = await this.cartItemModel.find({ cartId: cartIdObj }).session(session).lean().exec();
        // for (const it of items) { await this.inventory.release(it.skuId, it.quantity, { session }); }

        await this.cartItemModel
          .deleteMany({ cartId: cartIdObj })
          .session(session)
          .exec();

        // อัปเดตยอดรวม (จะเป็น 0 ทั้งคู่)
        await this.cartModel
          .updateOne(
            { _id: cartIdObj },
            { $set: { itemsCount: 0, itemsTotal: 0 } },
          )
          .session(session)
          .exec();

        // คืนค่ารายการหลังเคลียร์ (ว่าง)
        itemsAfter = await this.getCartItems(String(cartIdObj), {
          expandStore: true,
          withAvailability: true,
          session,
        });
      });

      return itemsAfter; // [] เสมอ
    } finally {
      await session.endSession();
    }
  }
}
