import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel, InjectConnection } from "@nestjs/mongoose";
import { CartItem, CartItemDocument } from "src/cart/schemas/cart-item.schema";
import { Cart, CartDocument } from "src/cart/schemas/cart.schema";
import { Order, OrderDocument } from "./schemas/order.schema";
import { InventoryService } from "src/inventory/inventory.service";
import { ClientSession, Connection, FilterQuery, Model, Types } from "mongoose";
import { CartService } from "src/cart/cart.service";
import { toClient } from "./utils/orders-helper";
import { PaymentsService } from "src/payments/payments.service";
import { UpdateFilter } from "mongodb";
import { Args, MarkPaidArgs, MarkPayingInput } from "./types/order.types";
import { MarkFailedArgs } from "./dto/order-transitions.dto";
import { CheckoutResponseDto } from "./dto/checkout-response.dto";
import { STRIPE_CLIENT } from "src/payments/constants";
import Stripe from "stripe";

@Injectable()
export class OrdersService {
  constructor(
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    @InjectModel(Cart.name) private readonly cartModel: Model<CartDocument>,
    @InjectModel(CartItem.name)
    private readonly cartItemModel: Model<CartItemDocument>,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    private readonly inv: InventoryService,
    private readonly pay: PaymentsService, // Assuming you have a PaymentService for handling payments
    private readonly cart: CartService, // Assuming you have a CartService for cart operations
    @InjectConnection() private readonly conn: Connection,
  ) {}

  async placeOrderFromCart({ dto, userId, cartKey, idemKey, setCookie }: Args) {
    // 0) โหลด/สร้าง cart (แบบเดียวกับ /cart GET)
    const cart = await this.cart.getOrCreateCart({
      userId: userId,
      cartKey,
      setCookie,
    });
    const items = await this.cartItemModel
      .find({ cartId: cart._id })
      .lean()
      .exec();
    if (!items.length) throw new BadRequestException("Cart is empty");

    // 1) Idempotency: ถ้ามี idemKey และเคยสร้างแล้ว ให้คืน order เดิม
    if (idemKey) {
      const existed = await this.orderModel.findOne({ idemKey }).lean().exec();
      if (existed) return toClient(existed);
    }

    // 2) คำนวณใหม่จาก cart (กันราคาหมดอายุ) + ตรวจ available
    //    (ในตัวอย่างนี้ สมมติ unitPrice/subtotal ใน cart item น่าเชื่อถือแล้ว)
    const totalQty = items.reduce((s, it) => s + (it.quantity ?? 0), 0);
    const totalAmount = items.reduce((s, it) => s + (it.subtotal ?? 0), 0);
    if (totalQty <= 0 || totalAmount < 0)
      throw new BadRequestException("Invalid cart totals");

    // 3) เปิด session (แนะนำเปิด replica set)
    const session = await this.conn.startSession();

    let created!: OrderDocument;

    try {
      const out = await session.withTransaction(async () => {
        // 3.1) สร้าง Order(pending_payment) + snapshot รายการ
        created = await this.orderModel
          .create(
            [
              {
                userId: userId ? new Types.ObjectId(userId) : undefined,
                cartId: cart._id,
                currency: cart.currency ?? "THB",
                status: "pending_payment",
                idemKey,
                itemsCount: totalQty,
                itemsTotal: totalAmount,
                items: items.map((it) => ({
                  productId: it.productId,
                  skuId: it.skuId,
                  storeId: it.storeId,
                  productName: it.productName,
                  productImage: it.productImage,
                  attributes: it.attributes ?? {},
                  unitPrice: it.unitPrice,
                  quantity: it.quantity,
                  subtotal: it.subtotal,
                })),
              },
            ],
            { session },
          )
          .then((r) => r[0]);

        // 3.2) Reserve stock รายบรรทัด (TTL 20 นาทีเป็นค่าเริ่มต้น)
        const ttlMinutes = 20;
        for (const it of items) {
          await this.inv.reserve(
            String(it.skuId),
            String(it.productId),
            String(it.storeId),
            it.quantity,
            {
              cartId: String(cart._id),
              userId: userId,
              ttlMinutes,
            },
            session,
          ); // ← ปรับ reserve ให้รองรับ session
        }
        created.reservationExpiresAt = new Date(Date.now() + 20 * 60_000);
        await created.save({ session });

        // 3.3) Create PaymentIntent/Link
        const payRes = await this.pay.createIntent({
          orderId: String(created._id),
          amount: totalAmount,
          method: dto.paymentMethod, // 'card'|'promptpay'|'cod'
        });
        // created.paymentProvider = payRes.clientSecret;
        created.paymentProvider = "stripe";
        created.paymentIntentId = payRes.intentId;
        // created.paymentLinkUrl = payRes.paymentUrl ?? undefined;
        await created.save({ session });

        // ✅ คืนของที่ FE ต้องใช้ (clientSecret ฯลฯ)
        return {
          orderId: String(created._id),
          amount: totalAmount,
          // customerEmail: /* ถ้ามี */,
          clientSecret: payRes.clientSecret,
        } as CheckoutResponseDto;
        // 3.4) (ทางเลือก) publish 'order.created' ไป MQ ที่นี่
      });

      // 4) (กรณี guest) ไม่ล้าง cart ทันที จนกว่าชำระเงินสำเร็จ (ป้องกัน user back)
      //    หรือจะล้างเฉพาะฝั่ง FE ก็ได้ แล้วอาศัย order status ในการตามต่อ

      return out;
      // eslint-disable-next-line no-useless-catch
    } catch (e: any) {
      // NOTE: ตรวจจับ error แบบ “not enough stock” จาก reserve แล้ว map เป็น 409
      // ถ้าต้องการส่งรายละเอียด skuId ที่ขาด
      throw e;
    } finally {
      await session.endSession();
    }
  }

  async userCanSee(userId: string, orderId: string): Promise<boolean> {
    // ป้องกัน BSONError
    if (!Types.ObjectId.isValid(orderId)) return false;
    if (!userId || !Types.ObjectId.isValid(userId)) return false;

    const userIdObj = new Types.ObjectId(userId);
    const orderIdObj = new Types.ObjectId(orderId);

    const exists = await this.orderModel
      .findOne({
        _id: orderIdObj,
        userId: userIdObj,
      })
      .lean()
      .exec();

    return !!exists;
  }

  async findById(orderId: string) {
    const orderIdObj = new Types.ObjectId(orderId);

    const res = await this.orderModel
      .findOne({ _id: orderIdObj })
      .lean()
      .exec();

    return res;
  }

  /**
   * ตอนไม่มีการตัดยอด (Payment Intent = processing):
   * - bind payment.intentId เข้ากับ order (ถ้ายังไม่เคย bind)
   * - อัปเดต payment.status = 'processing'
   * - อนุญาตเฉพาะคำสั่งซื้อที่ยังเป็น pending_payment เท่านั้น
   * - ทำงานได้ภายใต้ transaction (session)
   */
  async markPaying(
    orderId: string,
    info: MarkPayingInput,
    session?: ClientSession,
  ): Promise<void> {
    if (!info?.paymentIntentId) {
      throw new BadRequestException("paymentIntentId is required");
    }

    const orderIdObj = new Types.ObjectId(orderId);

    // เงื่อนไขป้องกัน:
    //  - ออเดอร์ต้องยังอยู่ที่ pending_payment
    //  - ถ้าเคยมี payment.intentId แล้ว ต้องเป็นตัวเดิม (idempotent)
    const filter = {
      orderIdObj,
      status: "pending_payment",
      $or: [
        { "payment.intentId": { $exists: false } },
        { "payment.intentId": info.paymentIntentId },
      ],
    };

    const set: UpdateFilter<OrderDocument>["$set"] = {
      status: "pending_payment",
      "payment.provider": info.provider ?? "stripe",
      "payment.intentId": info.paymentIntentId,
      "payment.status": "processing",
    };

    if (typeof info.amount === "number") set["payment.amount"] = info.amount;
    if (info.currency) set["payment.currency"] = info.currency.toLowerCase();

    const res = await this.orderModel.updateOne(
      filter,
      { $set: set },
      { session },
    );

    if (res.matchedCount === 0) {
      // ดูสาเหตุ
      const cur = await this.orderModel
        .findById(orderIdObj)
        .lean()
        .session(session ?? null);
      if (!cur) throw new NotFoundException("Order not found");

      // ถูกจ่ายไปแล้ว → ปล่อยผ่าน (idempotent) ไม่ต้อง error
      if (cur.status === "paid") return;

      // ถูกยกเลิก/หมดอายุ → ไม่ควรรับ processing แล้ว
      if (cur.status === "canceled" || cur.status === "expired") {
        throw new ConflictException(
          `Order is ${cur.status}, cannot mark as paying`,
        );
      }

      // มี intentId อื่นผูกอยู่แล้ว
      const bound = cur?.payment?.intentId;
      if (bound && bound !== info.paymentIntentId) {
        throw new ConflictException(
          "Order already bound to another payment intent",
        );
      }

      // มาถึงตรงนี้แปลว่า status ไม่ใช่ pending_payment
      if (cur.status !== "pending_payment") {
        throw new ConflictException(
          `Invalid order status: ${String(cur.status)}`,
        );
      }

      // กรณีอื่น ๆ (แทบไม่เกิด) — ไม่ทำอะไรต่อ
      return;
    }
  }

  async markPaid(
    orderId: string,
    data: MarkPaidArgs,
    session?: ClientSession,
  ): Promise<Order> {
    const orderIdObj = new Types.ObjectId(orderId);

    // อ่านก่อน เพื่อให้ logic ชัด และรองรับ idempotency
    const order = await this.orderModel
      .findById(orderIdObj)
      .session(session ?? null);
    if (!order) {
      throw new NotFoundException("Order not found");
    }

    // Idempotent: ถ้าเคยจ่ายแล้ว ให้คืนข้อมูลเดิมไปเลย
    if (order.status === "paid") {
      // (ถ้าต้องการ enforce ว่าต้องเป็น intent เดิม)
      // if (order.paymentIntentId && order.paymentIntentId !== data.paymentIntentId) {
      //   throw new ConflictException('Order already paid with different payment intent');
      // }
      return order.toObject();
    }

    // ป้องกันกรณีสถานะไม่ถูกต้อง
    if (order.status !== "pending_payment") {
      throw new ConflictException(
        `Cannot mark paid from status: ${order.status}`,
      );
    }

    // อัปเดตข้อมูลชำระเงิน
    order.status = "paid";
    order.paymentIntentId = data.paymentIntentId ?? order.paymentIntentId;
    if (data.chargeId) order.chargeId = data.chargeId;
    order.paidAt = data.paidAt ?? new Date();
    order.paidAmount = data.amount;
    order.paidCurrency = data.currency?.toUpperCase?.() ?? data.currency;

    await order.save({ session });

    // (ถ้าต้องการ) ล้างข้อมูล TTL reservationExpiresAt
    // order.reservationExpiresAt = undefined;

    return order.toObject();
  }

  /**
   * เปลี่ยนสถานะออเดอร์เป็น "canceled" เมื่อชำระไม่สำเร็จ/ยกเลิก
   * - idempotent-ish: ถ้าเป็น canceled อยู่แล้วจะถือว่าผ่าน
   * - กันพลาด: ถ้าสถานะเป็น paid แล้ว จะไม่ยอมให้ยกเลิก
   */
  async markFailed(
    orderId: string,
    info: MarkFailedArgs,
    session?: ClientSession,
  ): Promise<void> {
    const _id = new Types.ObjectId(orderId);

    // ยอมให้ยกเลิกได้เฉพาะออเดอร์ที่ยังไม่ได้จ่ายสำเร็จ
    const filter: FilterQuery<OrderDocument> = {
      _id,
      status: { $in: ["pending_payment", "expired", "canceled"] },
    };

    const set: UpdateFilter<OrderDocument>["$set"] = {
      status: "canceled",
      paymentIntentId: info.paymentIntentId,
      failureReason: info.failureReason,
      canceledAt: info.canceledAt ?? new Date(),
    };

    const res = await this.orderModel
      .updateOne(filter, { $set: set }, { session })
      .exec();

    if (res.matchedCount === 0) {
      // ไม่ติด filter → อาจจะมีสองเคส: ไม่เจอออเดอร์ / หรือสถานะเป็น paid ไปแล้ว
      const current = await this.orderModel
        .findById(_id)
        .select("_id status")
        .lean()
        .session(session || null); // ปลอดภัยถ้าไม่มี session
      if (!current) throw new NotFoundException("Order not found");
      if (current.status === "paid") {
        // ไม่ยอมให้ cancel ทับของจ่ายแล้ว
        throw new ConflictException("Order already paid");
      }
      // อื่น ๆ (เช่น ถูกลบ / สถานะไม่เข้าข่าย) — กันตก
      throw new BadRequestException("Order is not cancelable");
    }
  }
}
