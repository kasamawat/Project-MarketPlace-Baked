import { Injectable } from "@nestjs/common";
import { InjectConnection, InjectModel } from "@nestjs/mongoose";
import { ClientSession, Connection, Model, Types } from "mongoose";
import { Cart, CartDocument } from "../schemas/cart.schema";
import { CartItem, CartItemDocument } from "../schemas/cart-item.schema";
import { Sku, SkuDocument } from "src/skus/schemas/sku-schema";

type TotalsAgg = { itemsCount: number; itemsTotal: number };

@Injectable()
export class CartResolverService {
  constructor(
    @InjectModel(Cart.name) private readonly cartModel: Model<CartDocument>,
    @InjectModel(CartItem.name)
    private readonly cartItemModel: Model<CartItemDocument>,
    @InjectConnection() private readonly conn: Connection,
    @InjectModel(Sku.name) private readonly skuModel: Model<SkuDocument>,
  ) {}
  async recalcTotals(cartId: Types.ObjectId, session: ClientSession) {
    const [first] = await this.cartItemModel
      .aggregate<TotalsAgg>([
        { $match: { cartId } },
        {
          $group: {
            _id: null,
            itemsCount: { $sum: "$quantity" },
            itemsTotal: { $sum: "$subtotal" },
          },
        },
      ])
      .session(session)
      .exec();

    const itemsCount = first?.itemsCount ?? 0;
    const itemsTotal = first?.itemsTotal ?? 0;

    await this.cartModel
      .updateOne({ _id: cartId }, { $set: { itemsCount, itemsTotal } })
      .exec();
    return { itemsCount, itemsTotal };
  }

  async mergeGuestCartToUser(opts: {
    userId: string;
    cartKey: string | null;
    clearCookie?: () => void;
  }) {
    if (!opts.cartKey) return;

    const session = await this.conn.startSession();
    try {
      await session.withTransaction(async () => {
        const guest = await this.cartModel
          .findOne({ cartKey: opts.cartKey, status: "open" })
          .session(session);
        if (!guest) return;

        // หา/สร้าง user cart
        let userCart = await this.cartModel
          .findOne({ userId: new Types.ObjectId(opts.userId), status: "open" })
          .session(session);
        if (!userCart) {
          userCart = await this.cartModel
            .create(
              [
                {
                  userId: new Types.ObjectId(opts.userId),
                  status: "open",
                  itemsCount: 0,
                  itemsTotal: 0,
                },
              ],
              { session },
            )
            .then((r) => r[0]);
        }

        const guestItems = await this.cartItemModel
          .find({ cartId: guest._id })
          .session(session)
          .lean()
          .exec();

        for (const gi of guestItems) {
          // ตรวจ sku/สต็อกล่าสุด + ราคา snapshot
          const sku = await this.skuModel
            .findById(gi.skuId)
            .session(session)
            .lean();
          if (!sku || sku.purchasable === false) continue;
          const available = Math.max(
            0,
            (sku.onHand ?? 0) - (sku.reserved ?? 0),
          );
          if (available <= 0) continue;

          const unitPrice =
            typeof sku.price === "number" ? sku.price : (gi.unitPrice ?? 0);

          const exist = await this.cartItemModel
            .findOne({ cartId: userCart?._id, skuId: gi.skuId })
            .session(session);

          const qtyToAdd = Math.max(1, Math.min(gi.quantity ?? 1, available));
          if (exist) {
            const nextQty = Math.max(
              1,
              Math.min((exist.quantity ?? 0) + qtyToAdd, available),
            );
            exist.quantity = nextQty;
            exist.unitPrice = unitPrice;
            exist.subtotal = nextQty * unitPrice;
            await exist.save({ session });
          } else {
            await this.cartItemModel.create(
              [
                {
                  cartId: userCart?._id,
                  productId: gi.productId,
                  skuId: gi.skuId,
                  storeId: gi.storeId,
                  unitPrice,
                  quantity: qtyToAdd,
                  subtotal: qtyToAdd * unitPrice,
                  productName: gi.productName,
                  productImage: gi.productImage,
                  attributes: gi.attributes ?? {},
                },
              ],
              { session },
            );
          }
        }

        // ปิด guest cart + เคลียร์ cookie
        await this.cartItemModel
          .deleteMany({ cartId: guest._id })
          .session(session);
        guest.status = "merged";
        guest.expiresAt = new Date();
        await guest.save({ session });

        await this.recalcTotals(new Types.ObjectId(userCart?._id), session);

        opts.clearCookie?.();
      });
    } finally {
      await session.endSession();
    }
  }
}
