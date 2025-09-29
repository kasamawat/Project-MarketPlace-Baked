import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel, InjectConnection } from "@nestjs/mongoose";
import { CartItem, CartItemDocument } from "src/cart/schemas/cart-item.schema";
import { Cart, CartDocument } from "src/cart/schemas/cart.schema";
import { InventoryService } from "src/inventory/inventory.service";
import {
  ClientSession,
  Connection,
  FilterQuery,
  Model,
  PipelineStage,
  Types,
} from "mongoose";
import { CartService } from "src/cart/cart.service";
import {
  computeListStatusMaster,
  ensureOwnershipMaster,
} from "./utils/orders-helper";
import { PaymentsService } from "src/payments/payments.service";
import { UpdateFilter } from "mongodb";
import { FulfillmentStatus, PayMetaOut } from "./types/order.types";
import { ListOrdersDto } from "./dto/list-orders.dto";
import { StoreOrdersDto } from "src/store/dto/store-orders.dto";
import { StoreOrder, StoreOrderDocument } from "./schemas/store-order.schema";
import {
  MasterOrder,
  MasterOrderDocument,
} from "./schemas/master-order.schema";
import { CheckoutResponseDtoNew, PlaceOrderDto } from "./dto/place-order.dto";
import { BuyerListItemDto } from "./dto/buyer-order-list.dto";
import {
  BuyerDetailFacet,
  BuyerListFacet,
  BuyerOrderDetail,
  BuyerOrderDetailItem,
  BuyerOrderListItem,
} from "./types/buyer-order.types";
import {
  Reservation,
  ReservationDocument,
} from "src/inventory/schemas/reservation.schema";
import { STRIPE_CLIENT } from "src/payments/constants";
import Stripe from "stripe";
import { StoreOrderItems, StoreOrderFacet } from "./types/store-order.types";
import { StoreListItemDto } from "./dto/store-order-list.dto";
import {
  StoreOrderDetail,
  StoreOrderDetailItem,
} from "./types/store-order-detail.types";
import { StoreDetailItemDto } from "./dto/store-order-detail.dto";
import { computeItemStatus } from "./utils/pack-helper";
import { PackRequestDto } from "src/store/dto/pack.dto";
import { computeFulfillmentInfo } from "./helper/order-ship-helper";
import { ShipRequestDto } from "src/store/dto/ship.dto";
import { StoreOrderModelLean } from "./types/store-order-model";
import { ReportsResponseDto } from "./dto/order-report.response.dto";
import { parseRange } from "./helper/order-report-helper";
import { MQ_PUBLISHER } from "src/messaging/mq.tokens";
import { MqPublisher } from "src/messaging/mq.types";
import { PendingEvent } from "src/webhooks/types/webhooks-payment.types";
import { EXCHANGES } from "src/messaging/mq.topology";

@Injectable()
export class OrdersService {
  constructor(
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    @InjectModel(Cart.name) private readonly cartModel: Model<CartDocument>,
    @InjectModel(CartItem.name)
    private readonly cartItemModel: Model<CartItemDocument>,
    @InjectModel(StoreOrder.name)
    private readonly storeOrderModel: Model<StoreOrderDocument>,
    @InjectModel(MasterOrder.name)
    private readonly masterOrderModel: Model<MasterOrderDocument>,
    @InjectModel(Reservation.name)
    private readonly reservationModel: Model<ReservationDocument>,
    private readonly inv: InventoryService,
    private readonly pay: PaymentsService, // Assuming you have a PaymentService for handling payments
    private readonly cart: CartService, // Assuming you have a CartService for cart operations
    @Inject(MQ_PUBLISHER) private readonly mq: MqPublisher,
    @InjectConnection() private readonly conn: Connection,
  ) {}

  // =================================== Order Master ===================================
  async checkoutMaster({
    dto,
    userId,
    cartKey,
    idemKey,
    setCookie,
  }: {
    dto: PlaceOrderDto;
    userId: string;
    cartKey: string;
    idemKey?: string;
    setCookie: (k: string, v: string, maxAgeSec: number) => void;
  }): Promise<CheckoutResponseDtoNew> {
    // 0) โหลด cart
    const cart = await this.cart.getOrCreateCart({
      userId,
      cartKey,
      setCookie,
    });
    const cartItems = await this.cartItemModel
      .find({ cartId: cart._id })
      .lean()
      .exec();
    if (!cartItems.length) throw new BadRequestException("Cart is empty");

    // 1) idempotency (เช็คที่ MasterOrder)
    if (idemKey) {
      const existed = await this.masterOrderModel
        .findOne({ idemKey })
        .lean()
        .exec();
      if (existed) {
        if (["canceled", "expired"].includes(existed.status)) {
          throw new ConflictException(
            "This idempotency key is tied to a closed master order",
          );
        }
        const storeOrders = await this.storeOrderModel
          .find({ masterOrderId: existed._id })
          .select({ _id: 1, storeId: 1 })
          .lean()
          .exec();
        return {
          masterOrderId: String(existed._id as Types.ObjectId),
          storeOrders: storeOrders.map((s) => ({
            storeOrderId: String(s._id as Types.ObjectId),
            storeId: String(s.storeId),
          })),
          amount: existed.pricing?.grandTotal ?? 0,
          currency: existed.currency ?? "THB",
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          clientSecret: existed?.payment?.meta?.clientSecret,
          expiresAt: existed.reservationExpiresAt,
        };
      }
    }

    // 2) คำนวณ + group by store
    const totalQty = cartItems.reduce((s, it) => s + (it.quantity ?? 0), 0);
    const itemsTotal = cartItems.reduce((s, it) => s + (it.subtotal ?? 0), 0);
    if (totalQty <= 0 || itemsTotal < 0)
      throw new BadRequestException("Invalid cart totals");

    // group
    const byStore = new Map<string, typeof cartItems>();
    for (const it of cartItems) {
      const k = String(it.storeId);
      if (!byStore.has(k)) byStore.set(k, []);
      byStore.get(k)!.push(it);
    }

    // pricing (อย่างง่าย: ไม่คิดค่าส่ง/ส่วนลด/ภาษีในตัวอย่าง)
    const masterPricing = {
      itemsTotal,
      shippingFee: 0,
      discountTotal: 0,
      taxTotal: 0,
      grandTotal: itemsTotal,
    };
    const storesCount = byStore.size;
    const ttlMinutes = 2; // default 20
    const now = new Date();

    const session = await this.conn.startSession();
    try {
      const out = await session.withTransaction(async () => {
        // 3) สร้าง MasterOrder (pending_payment)
        const master = await this.masterOrderModel
          .create(
            [
              {
                buyerId: userId ? new Types.ObjectId(userId) : undefined,
                cartId: cart._id,
                currency: cart.currency ?? "THB",
                status: "pending_payment",
                idemKey,
                itemsCount: totalQty,
                storesCount,
                pricing: masterPricing,
                reservationExpiresAt: new Date(
                  now.getTime() + ttlMinutes * 60_000,
                ),
                timeline: [
                  {
                    type: "order.created",
                    at: now,
                    by: "system",
                    payload: { totalQty, itemsTotal },
                  },
                ],
                shippingAddress: dto.shippingAddress,
                billingAddress: dto.shippingAddress,
              },
            ],
            { session },
          )
          .then((r) => r[0]);

        // 4) สร้าง StoreOrders (pending_payment) ต่อร้าน
        const storeOrdersCreated: Array<{
          id: Types.ObjectId;
          storeId: Types.ObjectId;
        }> = [];
        for (const [storeIdStr, arr] of byStore.entries()) {
          const itemsCount = arr.reduce((s, it) => s + (it.quantity ?? 0), 0);
          const itemsTotalStore = arr.reduce(
            (s, it) => s + (it.subtotal ?? 0),
            0,
          );
          const pricingStore = {
            itemsTotal: itemsTotalStore,
            shippingFee: 0,
            discountTotal: 0,
            taxTotal: 0,
            grandTotal: itemsTotalStore,
          };

          const storeOrder = await this.storeOrderModel
            .create(
              [
                {
                  masterOrderId: master._id,
                  storeId: new Types.ObjectId(storeIdStr),
                  buyerId: master.buyerId,
                  buyerStatus: "pending_payment",
                  status: "PENDING",
                  currency: master.currency,
                  itemsCount,
                  pricing: pricingStore,
                  timeline: [
                    {
                      type: "storeorder.created",
                      at: now,
                      by: "system",
                      payload: { itemsCount, itemsTotal: itemsTotalStore },
                    },
                  ],
                  items: arr.map((it) => ({
                    productId: it.productId,
                    skuId: it.skuId,
                    storeId: it.storeId,
                    productName: it.productName,
                    productImage: it.productImage,
                    attributes: it.attributes ?? {},
                    unitPrice: it.unitPrice,
                    quantity: it.quantity,
                    subtotal: it.subtotal,
                    fulfillStatus: "AWAITING_PAYMENT",
                    fulfillTimeline: [
                      {
                        type: "order.item.created",
                        at: now,
                        by: "system",
                        payload: { qty: it.quantity },
                      },
                    ],
                  })),
                  shippingAddress: dto.shippingAddress,
                },
              ],
              { session },
            )
            .then((r) => r[0]);

          storeOrdersCreated.push({
            id: storeOrder._id as Types.ObjectId,
            storeId: storeOrder.storeId,
          });

          // 5) reserve stock ต่อแถว (ภายใน txn)
          for (const it of arr) {
            await this.inv.reserve(
              String(it.skuId),
              String(it.productId),
              String(it.storeId),
              String(master._id),
              it.quantity,
              { cartId: String(cart._id), userId, ttlMinutes },
              session,
            );
          }
        }

        // 6) สร้าง PaymentIntent (ระดับ Master)
        let clientSecret: string | undefined;
        if (dto.paymentMethod !== "cod") {
          const payRes = await this.pay.createIntent({
            masterOrderId: String(master._id),
            amount: masterPricing.grandTotal, // ถ้า PSP ต้อง minor unit ให้แปลงที่ provider
            method: dto.paymentMethod,
          });
          master.payment = {
            provider: "stripe",
            intentId: payRes.intentId,
            status: "processing",
            amount: masterPricing.grandTotal,
            currency: "THB",
            meta: { clientSecret: payRes.clientSecret },
          };
          master.paymentProvider = "stripe";
          master.paymentIntentId = payRes.intentId;
          clientSecret = payRes.clientSecret;
        } else {
          master.payment = {
            provider: "promptpay",
            status: "processing",
            amount: masterPricing.grandTotal,
            currency: "THB",
          };
        }
        await master.save({ session });

        return {
          masterOrderId: String(master._id),
          storeOrders: storeOrdersCreated.map((s) => ({
            storeOrderId: String(s.id),
            storeId: String(s.storeId),
          })),
          amount: masterPricing.grandTotal,
          currency: master.currency,
          clientSecret,
          expiresAt: master.reservationExpiresAt,
        };
      });

      // push event
      try {
        const pendingEvents: PendingEvent = {
          exchange: EXCHANGES.ORDERS_EVENTS,
          routingKey: "orders.created",
          payload: {
            eventId: `order:${out.masterOrderId}:created:${idemKey ?? "na"}`,
            buyerId: userId,
            masterOrderId: out.masterOrderId,
            orderNumber: out.masterOrderId, // หรือ orderNumber จริง
            total: out.amount,
            occurredAt: new Date().toISOString(),
            currency: out.currency ?? "THB",
            paymentMethod: dto.paymentMethod,
            expiresAt: out.expiresAt,
          },
          options: {
            messageId: `order:${out.masterOrderId}:created:${idemKey ?? "na"}`,
            persistent: true,
          },
        };

        await this.mq.publishTopic(
          pendingEvents.exchange,
          pendingEvents.routingKey,
          pendingEvents.payload,
          pendingEvents.options,
        );
      } catch (pubErr) {
        // ไม่ควร throw ทับผล checkout (แต่ควรมี alert/monitor)
        console.log(
          `orders.created publish failed: ${(pubErr as Error).message}`,
        );
      }

      return out;
    } finally {
      await session.endSession();
    }
  }

  // เมื่อ webhook/confirm สำเร็จ เรียก:
  async markMasterPaid(
    masterOrderId: string,
    info: {
      paymentIntentId?: string;
      chargeId?: string;
      amount: number;
      currency: string;
    },
    session?: ClientSession,
  ) {
    const masterOrderIdObj = new Types.ObjectId(masterOrderId);
    const now = new Date();

    // update paidAt, paidAmount, etc in master
    const res = await this.masterOrderModel
      .updateOne(
        {
          _id: masterOrderIdObj,
          status: "pending_payment",
          canceledAt: { $exists: false },
          expiredAt: { $exists: false },
        },
        {
          $set: {
            status: "paid",
            paymentIntentId: info.paymentIntentId,
            chargeId: info.chargeId,
            paidAt: now,
            paidAmount: info.amount,
            paidCurrency: info.currency?.toUpperCase?.() ?? info.currency,
            "payment.status": "succeeded",
          },
          $unset: { reservationExpiresAt: "" },
          $push: {
            timeline: {
              type: "order.paid",
              at: now,
              by: "system",
              payload: info,
            },
          },
        },
        { session },
      )
      .exec();

    if (res.matchedCount === 0) {
      const cur = await this.masterOrderModel
        .findById(masterOrderIdObj)
        .select("_id status")
        .lean()
        .session(session ?? null);
      if (!cur) throw new NotFoundException("Master order not found");
      if (cur.status === "paid") return; // idempotent
      throw new ConflictException(
        `Cannot mark paid from status: ${cur.status}`,
      );
    }

    // get storeOrders all from masterOrderId
    const stores = await this.storeOrderModel
      .find({ masterOrderId: masterOrderIdObj })
      .select({ _id: 1, itemsCount: 1, buyerStatus: 1, status: 1 })
      .session(session ?? null)
      .lean()
      .exec();
    // loop set each store StoreOrder:
    // - status: paid
    // - change item.fulfillStatus: AWAITING_PAYMENT → PENDING
    // - init fulfillment summary (UNFULFILLED, counters)
    for (const s of stores) {
      const sid = s._id;

      const baseFilter = {
        _id: sid,
        buyerStatus: { $in: ["pending_payment"] },
      };

      const initRes = await this.storeOrderModel
        .updateOne(
          baseFilter,
          [
            {
              $set: {
                buyerStatus: "paid",
                updatedAt: now,
                "fulfillment.status": "UNFULFILLED",
                "fulfillment.shippedItems": 0,
                "fulfillment.deliveredItems": 0,
                "fulfillment.totalItems": s.itemsCount ?? 0,
                "fulfillment.timeline": {
                  type: "store.pending",
                  by: "Store",
                  at: new Date(),
                },
              },
            },
          ],
          { session },
        )
        .exec();

      // 2) change fulfillStatus only line fulfillStatus: AWAITING_PAYMENT → PENDING
      if (initRes.modifiedCount > 0) {
        // 2.1) change status AWAITING_PAYMENT → PENDING
        await this.storeOrderModel
          .updateOne(
            { _id: sid },
            {
              $set: { "items.$[it].fulfillStatus": "PENDING" },
            },
            {
              session,
              arrayFilters: [
                { "it.fulfillStatus": { $in: ["AWAITING_PAYMENT", null] } },
              ],
            },
          )
          .exec();

        // 2.2) event 'payment.succeeded' save to StoreOrder (itemline)
        await this.storeOrderModel
          .updateOne(
            {
              _id: sid,
            },
            {
              $push: {
                timeline: {
                  type: "payment.succeeded",
                  at: now,
                  by: "system",
                  payload: { masterOrderId },
                },
              },
            },
            { session },
          )
          .exec();

        // Other Options :
        // update summary at master from fulfillment every store
      }
    }
  }

  // อัปเดตที่ MasterOrder เท่านั้น
  // ไม่เปลี่ยน StoreOrder (ยัง pending_payment)
  // กันกรณี intent ผิด
  async markMasterPaying(
    masterOrderId: string,
    info: {
      paymentIntentId: string;
      provider?: "stripe" | "promptpay" | "omise";
      amount?: number;
      currency?: string;
    },
    session?: ClientSession,
  ): Promise<void> {
    if (!info?.paymentIntentId) {
      throw new BadRequestException("paymentIntentId is required");
    }

    const _id = new Types.ObjectId(masterOrderId);

    const filter: FilterQuery<MasterOrderDocument> = {
      _id,
      status: "pending_payment",
      $or: [
        { "payment.intentId": { $exists: false } },
        { "payment.intentId": info.paymentIntentId }, // idempotent bind
      ],
    };

    const set: UpdateFilter<MasterOrderDocument>["$set"] = {
      status: "pending_payment",
      "payment.provider": info.provider ?? "stripe",
      "payment.intentId": info.paymentIntentId,
      "payment.status": "processing",
    };
    if (typeof info.amount === "number") set["payment.amount"] = info.amount;
    if (info.currency)
      set["payment.currency"] = info.currency.toUpperCase?.() ?? info.currency;

    const res = await this.masterOrderModel
      .updateOne(
        filter,
        {
          $set: set,
          $push: {
            timeline: {
              type: "payment.processing",
              at: new Date(),
              by: "system",
              payload: {
                intentId: info.paymentIntentId,
                provider: info.provider ?? "stripe",
              },
            },
          },
        },
        { session },
      )
      .exec();

    if (res.matchedCount === 0) {
      const cur = await this.masterOrderModel
        .findById(_id)
        .lean()
        .session(session ?? null);
      if (!cur) throw new NotFoundException("Master order not found");
      if (cur.status === "paid") return; // idempotent success
      if (cur.status === "canceled" || cur.status === "expired") {
        throw new ConflictException(
          `Master order is ${cur.status}, cannot mark as paying`,
        );
      }
      const bound = cur?.payment?.intentId;
      if (bound && bound !== info.paymentIntentId) {
        throw new ConflictException(
          "Master order already bound to another payment intent",
        );
      }
      // ถ้ายัง pending_payment แต่ไม่ match filter มักมาจาก race อย่างอื่น → เงียบ
      return;
    }
  }

  // เปลี่ยน MasterOrder.status = canceled
  // propagate ไปทุก StoreOrder: status = canceled, และถ้า item ยัง AWAITING_PAYMENT → set CANCELED
  // เคลียร์ reservationExpiresAt และ คืนสต็อก (แนะนำเรียก inv.releaseByMaster(masterId))
  async markMasterCanceled(
    masterOrderId: string,
    info: { paymentIntentId?: string; reason?: string; canceledAt?: Date } = {},
    session?: ClientSession,
  ): Promise<void> {
    const _id = new Types.ObjectId(masterOrderId);
    const now = info.canceledAt ?? new Date();

    const res = await this.masterOrderModel
      .updateOne(
        { _id, status: { $in: ["pending_payment"] } },
        {
          $set: {
            status: "canceled",
            paymentIntentId: info.paymentIntentId,
            failureReason: info.reason ?? "payment_failed",
            canceledAt: now,
          },
          $unset: { reservationExpiresAt: "" },
          $push: {
            timeline: {
              type: "order.canceled",
              at: now,
              by: "system",
              payload: { reason: info.reason ?? "payment_failed" },
            },
          },
        },
        { session },
      )
      .exec();

    if (res.matchedCount === 0) {
      const cur = await this.masterOrderModel
        .findById(_id)
        .select("_id status")
        .lean()
        .session(session ?? null);
      if (!cur) throw new NotFoundException("Master order not found");
      if (["canceled", "expired"].includes(cur.status)) return; // idempotent
      if (cur.status === "paid")
        throw new ConflictException("Master order already paid");
      return;
    }

    // propagate → StoreOrders
    await this.storeOrderModel
      .updateMany(
        { masterOrderId: _id, buyerStatus: { $in: ["pending_payment"] } },
        {
          $set: {
            buyerStatus: "canceled",
            status: "CANCELED",
            "items.$[it].fulfillStatus": "CANCELED",
          },
          $push: {
            timeline: { type: "storeorder.canceled", at: now, by: "system" },
          },
        },
        {
          session,
          arrayFilters: [
            {
              "it.fulfillStatus": {
                $in: ["AWAITING_PAYMENT", null, "PENDING"],
              },
            },
          ],
        },
      )
      .exec();

    // คืนสต็อก (ควรทำใน txn ถ้า reserve รองรับ session)
    try {
      await this.inv.releaseByMaster(String(_id), session);
    } catch {
      /* log warning */
    }
  }

  // logic ใกล้เคียง canceled แต่เหตุผลเป็น timeout
  // propagate + release stock เช่นเดียวกัน
  async markMasterExpired(
    masterOrderId: string,
    info: { reason?: string; expiredAt?: Date } = {},
    session?: ClientSession,
  ): Promise<void> {
    const _id = new Types.ObjectId(masterOrderId);
    const now = info.expiredAt ?? new Date();

    const res = await this.masterOrderModel
      .updateOne(
        { _id, status: { $in: ["pending_payment"] } },
        {
          $set: {
            status: "expired",
            failureReason: info.reason ?? "payment_timeout",
            expiredAt: now,
          },
          $unset: { reservationExpiresAt: "" },
          $push: {
            timeline: {
              type: "order.expired",
              at: now,
              by: "system",
              payload: { reason: info.reason ?? "payment_timeout" },
            },
          },
        },
        { session },
      )
      .exec();

    if (res.matchedCount === 0) return; // idempotent for other buyerStatus

    await this.storeOrderModel
      .updateMany(
        { masterOrderId: _id, buyerStatus: { $in: ["pending_payment"] } },
        {
          $set: {
            buyerStatus: "expired",
            status: "CANCELED",
            "items.$[it].fulfillStatus": "CANCELED",
          },
          $push: {
            timeline: { type: "storeorder.expired", at: now, by: "system" },
          },
        },
        {
          session,
          arrayFilters: [
            { "it.fulfillStatus": { $in: ["AWAITING_PAYMENT", null] } },
          ],
        },
      )
      .exec();

    try {
      await this.inv.releaseByMaster(String(_id), session);
    } catch {
      /* log warning */
    }
  }

  // ====================================================================================
  async listForBuyer(
    userId: string,
    q: ListOrdersDto,
  ): Promise<{ items: BuyerListItemDto[]; total: number }> {
    if (!Types.ObjectId.isValid(userId))
      throw new BadRequestException("Invalid user");
    const userIdObj = new Types.ObjectId(userId);
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(q.limit) || 10));
    const skip = (page - 1) * limit;

    // 1) master-level filter
    const filter: Record<string, any> = { buyerId: userIdObj };
    if (q.buyerStatus) {
      filter.status = q.buyerStatus; // ตรงกับ masterorders.status
    }

    const pipeline: PipelineStage[] = [
      { $match: filter },
      { $sort: { createdAt: -1 as 1 | -1 } },

      // 2) join storeorders (+ store name)
      {
        $lookup: {
          from: "storeorders",
          let: { mid: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$masterOrderId", "$$mid"] } } },
            // pull store
            {
              $lookup: {
                from: "stores",
                let: { sid: "$storeId" },
                pipeline: [
                  { $match: { $expr: { $eq: ["$_id", "$$sid"] } } },
                  { $project: { _id: 0, name: 1 } },
                ],
                as: "storeDoc",
              },
            },
            { $set: { storeDoc: { $first: "$storeDoc" } } },
            // merge ids for find in images
            {
              $set: {
                _items: { $ifNull: ["$items", []] },
              },
            },
            {
              $set: {
                skuIds: {
                  $map: { input: "$_items", as: "it", in: "$$it.skuId" },
                },
                productIds: {
                  $map: { input: "$_items", as: "it", in: "$$it.productId" },
                },
              },
            },
            // cover image of sku
            {
              $lookup: {
                from: "images",
                let: { ids: "$skuIds", sid: "$storeId" },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $in: ["$entityId", "$$ids"] },
                          { $eq: ["$entityType", "sku"] },
                          { $eq: ["$role", "cover"] },
                          { $eq: ["$storeId", "$$sid"] },
                          { $not: ["$deletedAt"] },
                        ],
                      },
                    },
                  },
                  {
                    $project: {
                      _id: 1,
                      entityId: 1,
                      role: 1,
                      order: 1,
                      publicId: 1,
                      version: 1,
                      width: 1,
                      height: 1,
                      format: 1,
                      url: 1,
                    },
                  },
                ],
                as: "skuCovers",
              },
            },
            // cover image of product
            {
              $lookup: {
                from: "images",
                let: { ids: "$productIds", sid: "$storeId" },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $in: ["$entityId", "$$ids"] },
                          { $eq: ["$entityType", "product"] },
                          { $eq: ["$role", "cover"] },
                          { $eq: ["$storeId", "$$sid"] },
                          { $not: ["$deletedAt"] },
                        ],
                      },
                    },
                  },
                  {
                    $project: {
                      _id: 1,
                      entityId: 1,
                      role: 1,
                      order: 1,
                      publicId: 1,
                      version: 1,
                      width: 1,
                      height: 1,
                      format: 1,
                      url: 1,
                    },
                  },
                ],
                as: "productCovers",
              },
            },
            // set itemsPreviews
            {
              $set: {
                itemsPreview: {
                  $slice: [
                    {
                      $map: {
                        input: "$_items",
                        as: "it",
                        in: {
                          name: "$$it.productName",
                          qty: "$$it.quantity",
                          image: "$$it.productImage",
                          attributes: "$$it.attributes",
                          fulfillStatus: "$$it.fulfillStatus",
                          cover: {
                            $let: {
                              vars: {
                                iSku: {
                                  $first: {
                                    $filter: {
                                      input: "$skuCovers",
                                      as: "img",
                                      cond: {
                                        $eq: ["$$img.entityId", "$$it.skuId"],
                                      },
                                    },
                                  },
                                },
                                iProd: {
                                  $first: {
                                    $filter: {
                                      input: "$productCovers",
                                      as: "img",
                                      cond: {
                                        $eq: [
                                          "$$img.entityId",
                                          "$$it.productId",
                                        ],
                                      },
                                    },
                                  },
                                },
                              },
                              in: {
                                $ifNull: [
                                  {
                                    _id: { $toString: "$$iSku._id" },
                                    role: "$$iSku.role",
                                    order: "$$iSku.order",
                                    publicId: "$$iSku.publicId",
                                    version: "$$iSku.version",
                                    width: "$$iSku.width",
                                    height: "$$iSku.height",
                                    format: "$$iSku.format",
                                    url: "$$iSku.url",
                                  },
                                  {
                                    _id: { $toString: "$$iProd._id" },
                                    role: "$$iProd.role",
                                    order: "$$iProd.order",
                                    publicId: "$$iProd.publicId",
                                    version: "$$iProd.version",
                                    width: "$$iProd.width",
                                    height: "$$iProd.height",
                                    format: "$$iProd.format",
                                    url: "$$iProd.url",
                                  },
                                ],
                              },
                            },
                          },
                        },
                      },
                    },
                    3,
                  ],
                },
              },
            },
            {
              $project: {
                _id: 1,
                storeId: 1,
                storeName: "$storeDoc.name",
                storeStatus: "$status",
                buyerStatus: "$buyerStatus",
                items: 1,
                itemsPreview: 1,
              },
            },
          ],
          as: "sos",
        },
      },

      // 3) ถ้ามี storeStatus ให้กรองเฉพาะ master ที่มี store order อย่างน้อย 1 อันตรงสถานะ
      ...(q.storeStatus
        ? ([
            {
              $match: {
                sos: { $elemMatch: { storeStatus: q.storeStatus.trim() } },
              },
            },
          ] as PipelineStage[])
        : ([] as PipelineStage[])),

      // 4) สร้าง storesSummary
      {
        $addFields: {
          storesSummary: {
            $map: {
              input: "$sos",
              as: "so",
              in: {
                storeOrderId: "$$so._id",
                storeId: "$$so.storeId",
                storeName: "$$so.storeName",
                storeStatus: "$$so.storeStatus",
                buyerStatus: "$$so.buyerStatus",
                itemsCount: {
                  $sum: {
                    $map: {
                      input: { $ifNull: ["$$so.items", []] },
                      as: "it",
                      in: { $ifNull: ["$$it.quantity", 0] },
                    },
                  },
                },
                itemsTotal: {
                  $sum: {
                    $map: {
                      input: { $ifNull: ["$$so.items", []] },
                      as: "it",
                      in: {
                        $cond: [
                          {
                            $and: [
                              { $ne: ["$$it.quantity", null] },
                              { $ne: ["$$it.unitPrice", null] },
                            ],
                          },
                          { $multiply: ["$$it.quantity", "$$it.unitPrice"] },
                          0,
                        ],
                      },
                    },
                  },
                },
                itemsPreview: { $slice: ["$$so.itemsPreview", 3] },
              },
            },
          },
        },
      },

      // 5) รวม items เพื่อ preview/total (fallback)
      {
        $addFields: {
          allItems: {
            $reduce: {
              input: { $ifNull: ["$sos", []] },
              initialValue: [],
              in: {
                $concatArrays: ["$$value", { $ifNull: ["$$this.items", []] }],
              },
            },
          },
        },
      },
      {
        $addFields: {
          itemsCountCalc: {
            $sum: {
              $map: {
                input: "$allItems",
                as: "f",
                in: { $ifNull: ["$$f.quantity", 0] },
              },
            },
          },
          itemsTotalCalc: {
            $sum: {
              $map: {
                input: "$allItems",
                as: "f",
                in: { $ifNull: ["$$f.subtotal", 0] },
              },
            },
          },
        },
      },

      // 6) ฟิลด์ที่ส่งออก
      {
        $project: {
          _id: 1,
          createdAt: 1,
          currency: 1,
          itemsCount: { $ifNull: ["$itemsCount", "$itemsCountCalc"] },
          itemsTotal: { $ifNull: ["$pricing.itemsTotal", "$itemsTotalCalc"] },
          reservationExpiresAt: 1,
          status: 1, // master status (= buyerStatus)
          payment: { status: "$payment.status" }, // เผื่อ compute badge
          storesSummary: 1,
        },
      },

      // 7) facet
      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],
          total: [{ $count: "count" }],
        },
      },
    ];

    const [facet] = await this.masterOrderModel
      .aggregate<BuyerListFacet>(pipeline)
      .exec();

    const items: BuyerOrderListItem[] = (facet?.data ?? []).map((m) => ({
      masterOrderId: String(m._id),
      createdAt: m.createdAt?.toISOString?.() ?? new Date().toISOString(),
      itemsCount: m.itemsCount ?? 0,
      itemsTotal: m.itemsTotal ?? 0,
      currency: m.currency ?? "THB",
      buyerStatus: m.status, // ใช้ตรง ๆ ตาม master.status
      reservationExpiresAt: m.reservationExpiresAt?.toISOString?.(),
      storesSummary: (m.storesSummary ?? []).map((s) => ({
        storeOrderId: String(s.storeOrderId),
        storeId: String(s.storeId),
        storeName: s.storeName ?? "",
        buyerStatus: s.buyerStatus,
        storeStatus: s.storeStatus,
        itemsCount: s.itemsCount ?? 0,
        itemsTotal: s.itemsTotal ?? 0,
        itemsPreview: s.itemsPreview,
      })),
    }));

    return { items, total: facet?.total?.[0]?.count || 0 };
  }

  async getBuyerMasterOrder(
    masterOrderId: string,
  ): Promise<BuyerOrderDetail | null> {
    if (!Types.ObjectId.isValid(masterOrderId)) return null;

    const masterOrderIdObj = new Types.ObjectId(masterOrderId);

    const pipeline: PipelineStage[] = [
      { $match: { _id: masterOrderIdObj } },
      {
        $lookup: {
          from: "storeorders",
          let: { mid: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [{ $eq: ["$masterOrderId", "$$mid"] }],
                },
              },
            },
            {
              $set: { storeStatus: "$status" },
            },
            // merge ids for find in images
            {
              $set: {
                _items: { $ifNull: ["$items", []] },
              },
            },
            {
              $set: {
                skuIds: {
                  $map: { input: "$_items", as: "it", in: "$$it.skuId" },
                },
                productIds: {
                  $map: { input: "$_items", as: "it", in: "$$it.productId" },
                },
              },
            },
            // cover image of sku
            {
              $lookup: {
                from: "images",
                let: { ids: "$skuIds", sid: "$storeId" },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $in: ["$entityId", "$$ids"] },
                          { $eq: ["$entityType", "sku"] },
                          { $eq: ["$role", "cover"] },
                          { $eq: ["$storeId", "$$sid"] },
                          { $not: ["$deletedAt"] },
                        ],
                      },
                    },
                  },
                  {
                    $project: {
                      _id: 1,
                      entityId: 1,
                      role: 1,
                      order: 1,
                      publicId: 1,
                      version: 1,
                      width: 1,
                      height: 1,
                      format: 1,
                      url: 1,
                    },
                  },
                ],
                as: "skuCovers",
              },
            },
            // cover image of product
            {
              $lookup: {
                from: "images",
                let: { ids: "$productIds", sid: "$storeId" },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $in: ["$entityId", "$$ids"] },
                          { $eq: ["$entityType", "product"] },
                          { $eq: ["$role", "cover"] },
                          { $eq: ["$storeId", "$$sid"] },
                          { $not: ["$deletedAt"] },
                        ],
                      },
                    },
                  },
                  {
                    $project: {
                      _id: 1,
                      entityId: 1,
                      role: 1,
                      order: 1,
                      publicId: 1,
                      version: 1,
                      width: 1,
                      height: 1,
                      format: 1,
                      url: 1,
                    },
                  },
                ],
                as: "productCovers",
              },
            },
            {
              $project: {
                _id: 1,
                storeId: 1,
                storeStatus: "$status",
                pricing: 1,
                items: {
                  $map: {
                    input: "$_items",
                    as: "it",
                    in: {
                      productId: "$$it.productId",
                      skuId: "$$it.skuId",
                      productName: "$$it.productName",
                      productImage: "$$it.productImage",
                      unitPrice: "$$it.unitPrice",
                      quantity: "$$it.quantity",
                      subtotal: "$$it.subtotal",
                      fulfillStatus: "$$it.fulfillStatus",
                      attributes: "$$it.attributes",
                      cover: {
                        $let: {
                          vars: {
                            iSku: {
                              $first: {
                                $filter: {
                                  input: "$skuCovers",
                                  as: "img",
                                  cond: {
                                    $eq: ["$$img.entityId", "$$it.skuId"],
                                  },
                                },
                              },
                            },
                            iProd: {
                              $first: {
                                $filter: {
                                  input: "$productCovers",
                                  as: "img",
                                  cond: {
                                    $eq: ["$$img.entityId", "$$it.productId"],
                                  },
                                },
                              },
                            },
                          },
                          in: {
                            $ifNull: [
                              {
                                _id: { $toString: "$$iSku._id" },
                                role: "$$iSku.role",
                                order: "$$iSku.order",
                                publicId: "$$iSku.publicId",
                                version: "$$iSku.version",
                                width: "$$iSku.width",
                                height: "$$iSku.height",
                                format: "$$iSku.format",
                                url: "$$iSku.url",
                              },
                              {
                                _id: { $toString: "$$iProd._id" },
                                role: "$$iProd.role",
                                order: "$$iProd.order",
                                publicId: "$$iProd.publicId",
                                version: "$$iProd.version",
                                width: "$$iProd.width",
                                height: "$$iProd.height",
                                format: "$$iProd.format",
                                url: "$$iProd.url",
                              },
                            ],
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          ],
          as: "stores",
        },
      },
      {
        $project: {
          _id: 1,
          createdAt: 1,
          currency: 1,
          status: 1,
          payment: 1,
          pricing: 1,
          reservationExpiresAt: 1,
          stores: 1,
          paidAt: 1,
        },
      },
    ];

    const [facet] = await this.masterOrderModel
      .aggregate<BuyerDetailFacet>(pipeline)
      .exec();
    if (!facet) return null;

    const result: BuyerOrderDetailItem = {
      masterOrderId: String(facet._id),
      createdAt: facet.createdAt?.toISOString?.() ?? new Date().toISOString(),
      currency: facet.currency ?? "THB",
      buyerStatus: computeListStatusMaster(facet),
      reservationExpiresAt: facet.reservationExpiresAt?.toISOString?.(),
      payment: facet.payment,
      pricing: facet.pricing && {
        itemsTotal: facet.pricing.itemsTotal ?? 0,
        shippingFee: facet.pricing.shippingFee ?? 0,
        discountTotal: facet.pricing.discountTotal ?? 0,
        taxTotal: facet.pricing.taxTotal ?? 0,
        grandTotal: facet.pricing.grandTotal ?? 0,
      },
      stores: (facet.stores ?? []).map((s) => ({
        storeOrderId: String(s._id),
        storeId: String(s.storeId),
        buyerStatus: s.buyerStatus,
        storeStatus: s.storeStatus,
        pricing: {
          itemsTotal: s.pricing?.itemsTotal ?? 0,
          grandTotal: s.pricing?.grandTotal ?? s.pricing?.itemsTotal ?? 0,
        },
        items: s.items.map((it) => ({
          productId: String(it.productId),
          skuId: String(it.skuId),
          productName: it.productName,
          productImage: it.productImage,
          unitPrice: it.unitPrice,
          quantity: it.quantity,
          subtotal: it.subtotal,
          fulfillStatus: it.fulfillStatus,
          attributes: it.attributes,
          cover: it.cover,
        })),
      })),
      paidAt: facet.paidAt,
    };

    return result;
  }

  async getBuyerOrderDetail(
    masterOrderId: string,
    storeOrderId: string,
  ): Promise<BuyerOrderDetail | null> {
    if (
      !Types.ObjectId.isValid(masterOrderId) ||
      !Types.ObjectId.isValid(storeOrderId)
    )
      return null;
    const masterOrderIdObj = new Types.ObjectId(masterOrderId);
    const storeOrderIdObj = new Types.ObjectId(storeOrderId);

    const pipeline: PipelineStage[] = [
      { $match: { _id: masterOrderIdObj } },
      {
        $lookup: {
          from: "storeorders",
          let: { mid: "$_id", sid: storeOrderIdObj },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$masterOrderId", "$$mid"] },
                    { $eq: ["$_id", "$$sid"] },
                  ],
                },
              },
            },
            // merge ids for find in images
            {
              $set: {
                _items: { $ifNull: ["$items", []] },
              },
            },
            {
              $set: {
                skuIds: {
                  $map: { input: "$_items", as: "it", in: "$$it.skuId" },
                },
                productIds: {
                  $map: { input: "$_items", as: "it", in: "$$it.productId" },
                },
              },
            },
            // cover image of sku
            {
              $lookup: {
                from: "images",
                let: { ids: "$skuIds", sid: "$storeId" },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $in: ["$entityId", "$$ids"] },
                          { $eq: ["$entityType", "sku"] },
                          { $eq: ["$role", "cover"] },
                          { $eq: ["$storeId", "$$sid"] },
                          { $not: ["$deletedAt"] },
                        ],
                      },
                    },
                  },
                  {
                    $project: {
                      _id: 1,
                      entityId: 1,
                      role: 1,
                      order: 1,
                      publicId: 1,
                      version: 1,
                      width: 1,
                      height: 1,
                      format: 1,
                      url: 1,
                    },
                  },
                ],
                as: "skuCovers",
              },
            },
            // cover image of product
            {
              $lookup: {
                from: "images",
                let: { ids: "$productIds", sid: "$storeId" },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $in: ["$entityId", "$$ids"] },
                          { $eq: ["$entityType", "product"] },
                          { $eq: ["$role", "cover"] },
                          { $eq: ["$storeId", "$$sid"] },
                          { $not: ["$deletedAt"] },
                        ],
                      },
                    },
                  },
                  {
                    $project: {
                      _id: 1,
                      entityId: 1,
                      role: 1,
                      order: 1,
                      publicId: 1,
                      version: 1,
                      width: 1,
                      height: 1,
                      format: 1,
                      url: 1,
                    },
                  },
                ],
                as: "productCovers",
              },
            },
            {
              $project: {
                _id: 1,
                storeId: 1,
                storeStatus: "$status",
                pricing: 1,
                items: {
                  $map: {
                    input: "$_items",
                    as: "it",
                    in: {
                      productId: "$$it.productId",
                      skuId: "$$it.skuId",
                      productName: "$$it.productName",
                      productImage: "$$it.productImage",
                      unitPrice: "$$it.unitPrice",
                      quantity: "$$it.quantity",
                      subtotal: "$$it.subtotal",
                      fulfillStatus: "$$it.fulfillStatus",
                      attributes: "$$it.attributes",
                      cover: {
                        $let: {
                          vars: {
                            iSku: {
                              $first: {
                                $filter: {
                                  input: "$skuCovers",
                                  as: "img",
                                  cond: {
                                    $eq: ["$$img.entityId", "$$it.skuId"],
                                  },
                                },
                              },
                            },
                            iProd: {
                              $first: {
                                $filter: {
                                  input: "$productCovers",
                                  as: "img",
                                  cond: {
                                    $eq: ["$$img.entityId", "$$it.productId"],
                                  },
                                },
                              },
                            },
                          },
                          in: {
                            $ifNull: [
                              {
                                _id: { $toString: "$$iSku._id" },
                                role: "$$iSku.role",
                                order: "$$iSku.order",
                                publicId: "$$iSku.publicId",
                                version: "$$iSku.version",
                                width: "$$iSku.width",
                                height: "$$iSku.height",
                                format: "$$iSku.format",
                                url: "$$iSku.url",
                              },
                              {
                                _id: { $toString: "$$iProd._id" },
                                role: "$$iProd.role",
                                order: "$$iProd.order",
                                publicId: "$$iProd.publicId",
                                version: "$$iProd.version",
                                width: "$$iProd.width",
                                height: "$$iProd.height",
                                format: "$$iProd.format",
                                url: "$$iProd.url",
                              },
                            ],
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          ],
          as: "stores",
        },
      },
      {
        $project: {
          _id: 1,
          createdAt: 1,
          currency: 1,
          status: 1,
          payment: 1,
          pricing: 1,
          reservationExpiresAt: 1,
          stores: 1,
          paidAt: 1,
        },
      },
    ];

    const [facet] = await this.masterOrderModel
      .aggregate<BuyerDetailFacet>(pipeline)
      .exec();
    if (!facet) return null;

    const result: BuyerOrderDetailItem = {
      masterOrderId: String(facet._id),
      createdAt: facet.createdAt?.toISOString?.() ?? new Date().toISOString(),
      currency: facet.currency ?? "THB",
      buyerStatus: computeListStatusMaster(facet),
      reservationExpiresAt: facet.reservationExpiresAt?.toISOString?.(),
      payment: facet.payment && {
        provider: facet.payment.provider,
        method: facet.payment.method,
        status: facet.payment.status,
        intentId: facet.payment.intentId,
        amount: facet.payment.amount,
        currency: facet.payment.currency,
      },
      pricing: facet.pricing && {
        itemsTotal: facet.pricing.itemsTotal ?? 0,
        shippingFee: facet.pricing.shippingFee ?? 0,
        discountTotal: facet.pricing.discountTotal ?? 0,
        taxTotal: facet.pricing.taxTotal ?? 0,
        grandTotal: facet.pricing.grandTotal ?? 0,
      },
      stores: (facet.stores ?? []).map((s) => ({
        storeOrderId: String(s._id),
        storeId: String(s.storeId),
        buyerStatus: s.buyerStatus,
        storeStatus: s.storeStatus,
        pricing: {
          itemsTotal: s.pricing?.itemsTotal ?? 0,
          grandTotal: s.pricing?.grandTotal ?? s.pricing?.itemsTotal ?? 0,
        },
        items: s.items.map((it) => ({
          productId: String(it.productId),
          skuId: String(it.skuId),
          productName: it.productName,
          productImage: it.productImage,
          unitPrice: it.unitPrice,
          quantity: it.quantity,
          subtotal: it.subtotal,
          fulfillStatus: it.fulfillStatus,
          attributes: it.attributes,
          cover: it.cover,
        })),
      })),
      paidAt: facet.paidAt,
    };

    return result;
  }

  async userCanSeeMaster(userId: string, masterOrderId: string) {
    const ok = await this.masterOrderModel.exists({
      _id: new Types.ObjectId(masterOrderId),
      buyerId: new Types.ObjectId(userId),
    });
    if (!ok) throw new NotFoundException("Order not found");
  }

  async userCanSeeStore(userId: string, storeOrderId: string) {
    const ok = await this.storeOrderModel.exists({
      _id: new Types.ObjectId(storeOrderId),
      buyerId: new Types.ObjectId(userId),
    });
    if (!ok) throw new NotFoundException("Order not found");
  }

  /** สำหรับหน้า /checkout/pay → คืน status + countdown + clientSecret (ถ้าต้องจ่าย) */
  async getPayMetaForMaster(
    masterOrderId: string,
    userId?: string,
  ): Promise<PayMetaOut> {
    const _id = new Types.ObjectId(masterOrderId);

    // อ่านเฉพาะฟิลด์ที่ต้องใช้
    const master = await this.masterOrderModel
      .findById(_id)
      .select(
        "buyerId status reservationExpiresAt pricing currency paymentProvider payment paymentIntentId",
      )
      .lean()
      .exec();

    if (!master) throw new NotFoundException("Order not found");
    ensureOwnershipMaster(master, userId);

    const now = new Date();
    const expiresAt: Date | undefined =
      master.reservationExpiresAt ?? undefined;

    // ถ้าหมดอายุแล้ว และยัง pending → mark expired ทันที (เปิด/ปิดได้ตามนโยบาย)
    if (
      master.status === "pending_payment" &&
      expiresAt &&
      expiresAt.getTime() <= now.getTime()
    ) {
      // soft transition → ไม่ขวางผู้ใช้ (หรือคุณจะ throw 410 ก็ได้)
      await this.markMasterExpired(masterOrderId, {
        reason: "payment_timeout",
        expiredAt: now,
      });
      master.status = "expired";
    }

    // base response
    const out: PayMetaOut = {
      masterOrderId: String(master._id as Types.ObjectId),
      status: master.status,
      reservationExpiresAt: expiresAt?.toISOString(),
      serverNow: now.toISOString(),
      amount: master?.pricing?.grandTotal ?? 0,
      currency: master.currency ?? "THB",
      provider: master.payment?.provider ?? master.paymentProvider,
    };

    // เฉพาะตอนยัง pending_payment และเป็น online payment เท่านั้น
    if (master.status === "pending_payment") {
      // ถ้าเป็น COD (หรือ provider บอกว่าเป็น offline) → ไม่ต้องให้ clientSecret
      const isCOD =
        master.payment?.method === "cod" ||
        (out.provider && out.provider.toLowerCase() === "cod");
      if (!isCOD) {
        let clientSecret: string | undefined;

        // มี intent เดิม → ขอ client_secret ก่อน
        const existingIntentId =
          master.paymentIntentId || master.payment?.intentId;
        if (existingIntentId) {
          const cs = await this.pay.getClientSecret(existingIntentId);
          if (cs) {
            clientSecret = cs;
          } else {
            // intent ใช้ไม่ได้แล้ว → สร้างใหม่
            const cr = await this.pay.createIntent({
              masterOrderId: String(_id),
              amount: out.amount, // ถ้า PSP ใช้ minor unit ให้แปลงใน provider
              method: master.payment?.method || "card",
            });

            await this.masterOrderModel.updateOne(
              { _id, status: "pending_payment" },
              {
                $set: {
                  paymentProvider: cr.provider ?? "stripe",
                  paymentIntentId: cr.intentId,
                  "payment.provider": cr.provider ?? "stripe",
                  "payment.intentId": cr.intentId,
                  "payment.status": "processing",
                  "payment.amount": out.amount,
                  "payment.currency": (master.currency ?? "THB").toUpperCase(),
                },
                $push: {
                  timeline: {
                    type: "payment.processing",
                    at: new Date(),
                    by: "system",
                    payload: { intentId: cr.intentId, reason: "recreated" },
                  },
                },
              },
            );

            clientSecret = cr.clientSecret;
            out.provider = cr.provider ?? out.provider ?? "stripe";
          }
        } else {
          // ยังไม่เคยมี intent → สร้างใหม่
          const cr = await this.pay.createIntent({
            masterOrderId: String(_id),
            amount: out.amount,
            method: master.payment?.method || "card",
          });

          await this.masterOrderModel.updateOne(
            { _id, status: "pending_payment" },
            {
              $set: {
                paymentProvider: cr.provider ?? "stripe",
                paymentIntentId: cr.intentId,
                "payment.provider": cr.provider ?? "stripe",
                "payment.intentId": cr.intentId,
                "payment.status": "processing",
                "payment.amount": out.amount,
                "payment.currency": (master.currency ?? "THB").toUpperCase(),
              },
              $push: {
                timeline: {
                  type: "payment.processing",
                  at: new Date(),
                  by: "system",
                  payload: { intentId: cr.intentId, reason: "created" },
                },
              },
            },
          );

          clientSecret = cr.clientSecret;
          out.provider = cr.provider ?? out.provider ?? "stripe";
        }

        if (clientSecret) out.clientSecret = clientSecret;
      }
    }

    return out;
  }

  // function clear cart when paid success
  async finalizeCartAfterPaid(
    masterOrderId: string,
    session?: ClientSession,
  ): Promise<void> {
    const _id = new Types.ObjectId(masterOrderId);

    // 1) อ่าน master เพื่อให้ได้ cartId (ถ้ามี)
    const master = await this.masterOrderModel
      .findById(_id)
      .select({ _id: 1, buyerId: 1, cartId: 1 })
      .lean()
      .session(session ?? null);

    if (!master) throw new NotFoundException("Order not found");

    // 2) หา cartId ให้ได้แน่ชัด (แหล่งหลัก = master.cartId)
    let cartId: Types.ObjectId | undefined = master.cartId;

    // 2.1) Fallback: ถ้าคุณบันทึก reservation ผูกกับ masterOrderId เอาไว้
    if (!cartId) {
      const r = await this.reservationModel
        .findOne({ masterOrderId: _id }) // << ต้องมี field นี้ใน reservations
        .select({ cartId: 1 })
        .lean()
        .session(session ?? null);
      cartId = r?.cartId;
    }

    // 2.2) Fallback สุดท้าย (ไม่แนะนำ): เดาจาก buyerId (อาจผิดถ้ามีหลาย cart)
    if (!cartId && master.buyerId) {
      const c = await this.cartModel
        .findOne({ userId: master.buyerId })
        .select({ _id: 1 })
        .lean()
        .session(session ?? null);
      cartId = c?._id ?? undefined;
    }

    if (!cartId) {
      // ขาดลิงก์ cart → เลือกหนึ่ง: (a) เงียบ, (b) warn, (c) error
      // ผมแนะนำ warn + return เพื่อ idempotent
      console.log(
        `finalizeCartAfterPaid: missing cartId for master ${masterOrderId}`,
      );
      return;
    }

    // 3) ลบ cart items (idempotent)
    await this.cartItemModel
      .deleteMany({ cartId })
      .session(session ?? null)
      .exec();

    // 4) มาร์ค cart ว่า converted (idempotent)
    await this.cartModel
      .updateOne(
        { _id: cartId },
        {
          $set: {
            status: "converted",
            convertedAt: new Date(),
            orderId: _id,
            locked: false,
          },
        },
        { session },
      )
      .exec();
  }

  // ================================= Tranfer to Store =================================
  async transfersToStores(
    masterOrderId: string,
    session?: ClientSession,
  ): Promise<void> {
    const stores = await this.storeOrderModel.find({ masterOrderId }).lean();
    for (const s of stores) {
      const payoutAmount = Math.round(s.pricing.grandTotal * 100); // - s.platformFeeMinor; // THB -> satang
      if (payoutAmount > 0) {
        const tr = await this.stripe.transfers.create({
          amount: payoutAmount,
          currency: "thb",
          destination: "TEST", //s.stripeAccountId, // ร้านค้าที่จะโอนเงินไป
          transfer_group: masterOrderId,
          metadata: {
            masterOrderId,
            storeOrderId: String(s._id as Types.ObjectId),
          },
        });

        await this.storeOrderModel.updateOne(
          { _id: s._id },
          { $set: { stripeTransferId: tr.id } },
          { session },
        );
      }
    }
  }
  // ====================================================================================
  // ================================= Store Order =================================
  /** รายการออเดอร์ของ “ร้าน” (อ่านจาก StoreOrder โดยตรง) */
  async listStoreOrders(
    q: StoreOrdersDto,
    storeId: string,
  ): Promise<{ items: StoreListItemDto[]; total: number }> {
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(q.limit) || 10));
    const skip = (page - 1) * limit;

    if (!Types.ObjectId.isValid(storeId)) {
      throw new BadRequestException("Invalid storeId");
    }
    const storeIdObj = new Types.ObjectId(storeId);

    // -------- parse buyerStatus (payStatus) ----------
    const buyerStatuses =
      q.buyerStatus && q.buyerStatus !== "all"
        ? q.buyerStatus
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : null;

    // -------- parse storeStatus ----------
    const rawStoreStatus =
      q.storeStatus && q.storeStatus !== "all"
        ? q.storeStatus
            ?.split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    const storeStatusArray = Array.from(new Set(rawStoreStatus));

    // -------- Pipeline ----------
    const pipeline: PipelineStage[] = [
      {
        $match: {
          storeId: storeIdObj,
          ...(storeStatusArray.length
            ? { status: { $in: storeStatusArray } }
            : {}),
          ...(buyerStatuses?.length
            ? { buyerStatus: { $in: buyerStatuses } }
            : {}),
        },
      },
      { $sort: { createdAt: -1 as 1 | -1 } },

      // Buyer info
      {
        // find buyer
        $lookup: {
          from: "users",
          let: { uid: "$buyerId" },
          pipeline: [
            { $match: { $expr: { $eq: ["$_id", "$$uid"] } } },
            { $project: { _id: 1, username: 1, email: 1 } },
          ],
          as: "buyer",
        },
      },
      { $set: { buyer: { $first: "$buyer" } } },
      // merge ids for find in images
      {
        $set: {
          _items: { $ifNull: ["$items", []] },
        },
      },
      {
        $set: {
          skuIds: {
            $map: { input: "$_items", as: "it", in: "$$it.skuId" },
          },
          productIds: {
            $map: { input: "$_items", as: "it", in: "$$it.productId" },
          },
        },
      },
      // cover image of sku
      {
        $lookup: {
          from: "images",
          let: { ids: "$skuIds", sid: "$storeId" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $in: ["$entityId", "$$ids"] },
                    { $eq: ["$entityType", "sku"] },
                    { $eq: ["$role", "cover"] },
                    { $eq: ["$storeId", "$$sid"] },
                    { $not: ["$deletedAt"] },
                  ],
                },
              },
            },
            {
              $project: {
                _id: 1,
                entityId: 1,
                role: 1,
                order: 1,
                publicId: 1,
                version: 1,
                width: 1,
                height: 1,
                format: 1,
                url: 1,
              },
            },
          ],
          as: "skuCovers",
        },
      },
      // cover image of product
      {
        $lookup: {
          from: "images",
          let: { ids: "$productIds", sid: "$storeId" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $in: ["$entityId", "$$ids"] },
                    { $eq: ["$entityType", "product"] },
                    { $eq: ["$role", "cover"] },
                    { $eq: ["$storeId", "$$sid"] },
                    { $not: ["$deletedAt"] },
                  ],
                },
              },
            },
            {
              $project: {
                _id: 1,
                entityId: 1,
                role: 1,
                order: 1,
                publicId: 1,
                version: 1,
                width: 1,
                height: 1,
                format: 1,
                url: 1,
              },
            },
          ],
          as: "productCovers",
        },
      },
      // คำนวณ summary/preview จาก items ทั้งหมด (ไม่ต้อง filter แล้ว)
      {
        $addFields: {
          itemsCount: {
            $sum: {
              $map: {
                input: { $ifNull: ["$items", []] },
                as: "f",
                in: "$$f.quantity",
              },
            },
          },
          itemsTotal: {
            $sum: {
              $map: {
                input: { $ifNull: ["$items", []] },
                as: "f",
                in: "$$f.subtotal",
              },
            },
          },
          itemsPreview: {
            $slice: [
              {
                $map: {
                  input: "$_items",
                  as: "it",
                  in: {
                    name: "$$it.productName",
                    qty: "$$it.quantity",
                    attributes: "$$it.attributes",
                    fulfillStatus: "$$it.fulfillStatus",
                    cover: {
                      $let: {
                        vars: {
                          iSku: {
                            $first: {
                              $filter: {
                                input: "$skuCovers",
                                as: "img",
                                cond: {
                                  $eq: ["$$img.entityId", "$$it.skuId"],
                                },
                              },
                            },
                          },
                          iProd: {
                            $first: {
                              $filter: {
                                input: "$productCovers",
                                as: "img",
                                cond: {
                                  $eq: ["$$img.entityId", "$$it.productId"],
                                },
                              },
                            },
                          },
                        },
                        in: {
                          $ifNull: [
                            {
                              _id: { $toString: "$$iSku._id" },
                              role: "$$iSku.role",
                              order: "$$iSku.order",
                              publicId: "$$iSku.publicId",
                              version: "$$iSku.version",
                              width: "$$iSku.width",
                              height: "$$iSku.height",
                              format: "$$iSku.format",
                              url: "$$iSku.url",
                            },
                            {
                              _id: { $toString: "$$iProd._id" },
                              role: "$$iProd.role",
                              order: "$$iProd.order",
                              publicId: "$$iProd.publicId",
                              version: "$$iProd.version",
                              width: "$$iProd.width",
                              height: "$$iProd.height",
                              format: "$$iProd.format",
                              url: "$$iProd.url",
                            },
                          ],
                        },
                      },
                    },
                  },
                },
              },
              3,
            ],
          },
        },
      },

      // Project fields
      {
        $project: {
          _id: 1,
          masterOrderId: 1,
          createdAt: 1,
          currency: 1,
          storeStatus: 1, // ใช้ filter ได้โดยตรง
          buyerStatus: 1, // payStatus
          itemsPreview: 1,
          itemsCount: 1,
          itemsTotal: 1,
          fulfillment: 1,
          buyer: 1,
        },
      },

      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],
          total: [{ $count: "count" }],
        },
      },
    ];

    const [facet] = await this.storeOrderModel
      .aggregate<StoreOrderFacet>(pipeline)
      .exec();

    const items: StoreOrderItems[] = (facet?.data ?? []).map((o) => ({
      masterOrderId: String(o.masterOrderId),
      storeOrderId: String(o._id),
      createdAt: o.createdAt?.toISOString?.() ?? new Date().toISOString(),
      itemsPreview: o.itemsPreview ?? [],
      itemsCount: o.itemsCount ?? 0,
      itemsTotal: o.itemsTotal ?? 0,
      currency: o.currency ?? "THB",
      buyerStatus: o.buyerStatus,
      storeStatus: o.storeStatus,
      fulfillment: o.fulfillment,
      buyer: o.buyer,
    }));

    const total = facet?.total?.[0]?.count ?? 0;
    return { items, total };
  }

  async getStoreOrder(storeId: string) {
    if (!Types.ObjectId.isValid(storeId)) {
      throw new BadRequestException("Invalid storeId"); // ✅ แก้ข้อความ
    }
    const storeIdObj = new Types.ObjectId(storeId);

    const pipeline: PipelineStage[] = [
      {
        $match: {
          storeId: storeIdObj,
          status: { $nin: ["CANCELED", "EXPIRED", "REFUNDED"] },
        },
      },
      {
        $group: {
          _id: null,
          ordersCount: { $sum: 1 },
          orderSucc: {
            $sum: {
              $cond: [{ $eq: ["$status", "DELIVERED"] }, 1, 0],
            },
          },
          totalEarn: {
            $sum: {
              $cond: [
                { $eq: ["$status", "DELIVERED"] },
                "$pricing.itemsTotal",
                0,
              ],
            },
          },
        },
      },
      { $project: { _id: 0, ordersCount: 1, orderSucc: 1, totalEarn: 1 } },
    ];

    const [storeOrders] = await this.storeOrderModel
      .aggregate<{
        ordersCount: number;
        orderSucc: number;
        totalEarn: number;
      }>(pipeline)
      .exec();

    // ✅ กันเคสไม่มีออเดอร์
    return (
      storeOrders ?? {
        ordersCount: 0,
        orderSucc: 0,
        totalEarn: 0,
      }
    );
  }

  async getStoreOrderDetail(
    storeOrderId: string,
    storeId: string,
  ): Promise<StoreDetailItemDto> {
    if (!Types.ObjectId.isValid(storeId)) {
      throw new BadRequestException("Invalid storeOrderId");
    }
    if (!Types.ObjectId.isValid(storeOrderId)) {
      throw new BadRequestException("Invalid storeOrderId");
    }
    const storeIdObj = new Types.ObjectId(storeId);
    const storeOrderIdObj = new Types.ObjectId(storeOrderId);

    const pipeline: PipelineStage[] = [
      {
        $match: {
          _id: storeOrderIdObj,
          storeId: storeIdObj,
        },
      },
      // join buyer
      {
        $lookup: {
          from: "users",
          let: { uid: "$buyerId" },
          pipeline: [
            { $match: { $expr: { $eq: ["$_id", "$$uid"] } } },
            { $project: { _id: 1, username: 1, email: 1 } },
          ],
          as: "buyer",
        },
      },
      { $set: { buyer: { $first: "$buyer" } } },
      // merge ids for find in images
      {
        $set: {
          _items: { $ifNull: ["$items", []] },
        },
      },
      {
        $set: {
          skuIds: {
            $map: { input: "$_items", as: "it", in: "$$it.skuId" },
          },
          productIds: {
            $map: { input: "$_items", as: "it", in: "$$it.productId" },
          },
        },
      },
      // cover image of sku
      {
        $lookup: {
          from: "images",
          let: { ids: "$skuIds", sid: "$storeId" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $in: ["$entityId", "$$ids"] },
                    { $eq: ["$entityType", "sku"] },
                    { $eq: ["$role", "cover"] },
                    { $eq: ["$storeId", "$$sid"] },
                    { $not: ["$deletedAt"] },
                  ],
                },
              },
            },
            {
              $project: {
                _id: 1,
                entityId: 1,
                role: 1,
                order: 1,
                publicId: 1,
                version: 1,
                width: 1,
                height: 1,
                format: 1,
                url: 1,
              },
            },
          ],
          as: "skuCovers",
        },
      },
      // cover image of product
      {
        $lookup: {
          from: "images",
          let: { ids: "$productIds", sid: "$storeId" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $in: ["$entityId", "$$ids"] },
                    { $eq: ["$entityType", "product"] },
                    { $eq: ["$role", "cover"] },
                    { $eq: ["$storeId", "$$sid"] },
                    { $not: ["$deletedAt"] },
                  ],
                },
              },
            },
            {
              $project: {
                _id: 1,
                entityId: 1,
                role: 1,
                order: 1,
                publicId: 1,
                version: 1,
                width: 1,
                height: 1,
                format: 1,
                url: 1,
              },
            },
          ],
          as: "productCovers",
        },
      },
      // join master order
      {
        $lookup: {
          from: "masterorders",
          let: { mid: "$masterOrderId" },
          pipeline: [
            { $match: { $expr: { $eq: ["$_id", "$$mid"] } } },
            { $project: { _id: 1, payment: 1, shippingAddress: 1 } },
          ],
          as: "masterOrders",
        },
      },
      {
        $set: {
          masterOrder: { $first: "$masterOrders" },
        },
      },

      // compute item summary/preview
      {
        $addFields: {
          itemsCount: {
            $sum: {
              $map: { input: "$items", as: "f", in: "$$f.quantity" },
            },
          },
          itemsTotal: {
            $sum: {
              $map: { input: "$items", as: "f", in: "$$f.subtotal" },
            },
          },
          itemsPreview: {
            $map: {
              input: "$_items",
              as: "it",
              in: {
                productId: "$$it.productId",
                skuId: "$$it.skuId",
                name: "$$it.productName",
                attributes: "$$it.attributes",
                quantity: "$$it.quantity",
                price: "$$it.unitPrice",
                subtotal: "$$it.subtotal",
                packedQty: "$$it.packedQty",
                shippedQty: "$$it.shippedQty",
                deliveredQty: "$$it.deliveredQty",
                canceledQty: "$$it.canceledQty",
                fulfillStatus: "$$it.fulfillStatus",
                cover: {
                  $let: {
                    vars: {
                      iSku: {
                        $first: {
                          $filter: {
                            input: "$skuCovers",
                            as: "img",
                            cond: {
                              $eq: ["$$img.entityId", "$$it.skuId"],
                            },
                          },
                        },
                      },
                      iProd: {
                        $first: {
                          $filter: {
                            input: "$productCovers",
                            as: "img",
                            cond: {
                              $eq: ["$$img.entityId", "$$it.productId"],
                            },
                          },
                        },
                      },
                    },
                    in: {
                      $ifNull: [
                        {
                          _id: { $toString: "$$iSku._id" },
                          role: "$$iSku.role",
                          order: "$$iSku.order",
                          publicId: "$$iSku.publicId",
                          version: "$$iSku.version",
                          width: "$$iSku.width",
                          height: "$$iSku.height",
                          format: "$$iSku.format",
                          url: "$$iSku.url",
                        },
                        {
                          _id: { $toString: "$$iProd._id" },
                          role: "$$iProd.role",
                          order: "$$iProd.order",
                          publicId: "$$iProd.publicId",
                          version: "$$iProd.version",
                          width: "$$iProd.width",
                          height: "$$iProd.height",
                          format: "$$iProd.format",
                          url: "$$iProd.url",
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },

      // final shape
      {
        $project: {
          _id: 1,
          masterOrderId: 1,
          storeId: 1,
          createdAt: 1,
          currency: 1,
          // status: 1, // pay-status ของ store order
          storeStatus: "$status",
          buyerStatus: 1,
          payment: "$masterOrder.payment",
          pricingGrandTotal: "$pricing.grandTotal",
          shippingAddress: "$masterOrder.shippingAddress",
          itemsPreview: 1,
          itemsCount: 1,
          itemsTotal: 1,
          fulfillment: 1,
          buyer: 1,
        },
      },
    ];

    const [storeDetail] = await this.storeOrderModel
      .aggregate<StoreOrderDetail>(pipeline)
      .exec();

    const items: StoreOrderDetailItem = {
      masterOrderId: String(storeDetail.masterOrderId),
      storeOrderId: String(storeDetail._id),
      storeId: String(storeDetail.storeId),
      storeStatus: storeDetail.storeStatus,
      buyerStatus: storeDetail.buyerStatus,
      buyer: storeDetail.buyer,
      shippingAddress: storeDetail.shippingAddress,
      itemsPreview: storeDetail.itemsPreview,
      itemsCount: storeDetail.itemsCount ?? 0,
      itemsTotal: storeDetail.itemsTotal ?? 0,
      payment: storeDetail.payment,
      fulfillment: storeDetail.fulfillment,
      createdAt:
        storeDetail.createdAt?.toISOString?.() ?? new Date().toISOString(),
      updatedAt:
        storeDetail.updatedAt?.toISOString?.() ?? new Date().toISOString(),
    };

    return items;
  }

  /**
   * Update fulfill status for a specific item (skuId) or all items in a store order.
   * - Validates allowed status
   * - Prevents backward transitions (PENDING->PACKED->SHIPPED->DELIVERED; CANCELED is terminal)
   * - Updates fulfillment summary + timeline
   * - Returns latest order (lean)
   */
  async packStoreOrder(
    storeId: string,
    storeOrderId: string,
    dto: PackRequestDto,
  ) {
    const storeIdObj = new Types.ObjectId(storeId);
    const storeOrderIdObj = new Types.ObjectId(storeOrderId);

    const order = await this.storeOrderModel
      .findOne({
        _id: storeOrderIdObj,
        storeId: storeIdObj,
      })
      .exec();

    if (!order) throw new NotFoundException("Store order not found");
    if (order.buyerStatus !== "paid") {
      // ธุรกิจคุณอาจอนุญาตให้แพ็กตอนยังไม่ paid ก็ได้
      throw new ForbiddenException("Order not paid");
    }

    // สร้าง map items ในออเดอร์เพื่อเช็ค outstandings
    const byKey = new Map<
      string,
      {
        idx: number;
        qty: number;
        packed: number;
        shipped: number;
        delivered: number;
        canceled: number;
      }
    >();
    order.items.forEach((it, idx) => {
      const key = `${String(it.productId)}::${String(it.skuId)}`;
      byKey.set(key, {
        idx,
        qty: it.quantity,
        packed: it.packedQty ?? 0,
        shipped: it.shippedQty ?? 0,
        delivered: it.deliveredQty ?? 0,
        canceled: it.canceledQty ?? 0,
      });
    });

    // ตรวจ payload และคำนวณว่าจะ $inc อะไร
    const incMap: Record<string, number> = {}; // path -> +qty
    const pkgItems: Record<string, unknown>[] = [];

    for (const it of dto.items) {
      const key = `${it.productId}::${it.skuId}`;
      const row = byKey.get(key);
      if (!row) throw new BadRequestException(`Item not found: ${key}`);

      const outstanding = Math.max(0, row.qty - row.packed - row.canceled);
      if (it.qty <= 0) throw new BadRequestException(`Invalid qty for ${key}`);
      if (it.qty > outstanding) {
        throw new BadRequestException(
          `Qty exceed outstanding for ${key} (${it.qty} > ${outstanding})`,
        );
      }

      // สร้าง $inc สำหรับ items.$[itX].packedQty
      const filterIdx = pkgItems.length; // ใช้ idx เดียวกับ arrayFilters
      incMap[`items.$[it${filterIdx}].packedQty`] =
        (incMap[`items.$[it${filterIdx}].packedQty`] || 0) + it.qty;

      // เก็บรายการลงกล่อง (snapshot ชื่อ)
      const origin = order.items[row.idx];
      pkgItems.push({
        productId: new Types.ObjectId(it.productId),
        skuId: new Types.ObjectId(it.skuId),
        qty: it.qty,
        productName: origin?.productName,
      });
    }

    const newPackage = {
      code: undefined,
      boxType: dto.package?.boxType,
      weightKg: dto.package?.weightKg,
      dimension: dto.package?.dimension,
      note: dto.package?.note,
      items: pkgItems,
      createdAt: new Date(),
    };

    // ทำใน transaction (ถ้าคุณใช้ replica set) จะปลอดภัยกว่า
    const session = await this.conn.startSession();
    try {
      await session.withTransaction(async () => {
        await this.storeOrderModel.updateOne(
          { _id: storeOrderIdObj, storeId: storeIdObj },
          {
            $push: {
              "fulfillment.packages": newPackage,
              "fulfillment.timeline": {
                type: "store.packed",
                at: new Date(),
                by: "Store",
                payload: dto.package,
              },
            },
            $inc: incMap,
          },
          {
            arrayFilters: pkgItems.map((x, i) => ({
              [`it${i}.productId`]: x.productId,
              [`it${i}.skuId`]: x.skuId,
            })),
            session,
          },
        );

        // อ่านกลับมาเพื่อคำนวณสถานะ items ตามตัวนับล่าสุด
        const updated = await this.storeOrderModel
          .findOne({ _id: storeOrderIdObj })
          .session(session);
        if (!updated)
          throw new NotFoundException("Store order not found after update");

        // sync fulfillStatus per item
        updated.items = updated.items.map((it) => {
          const status = computeItemStatus(
            it.quantity,
            it.packedQty ?? 0,
            it.shippedQty ?? 0,
            it.deliveredQty ?? 0,
            it.canceledQty ?? 0,
          );
          // add time line in items
          it.fulfillTimeline.push({
            type: "store.packed",
            by: "Store",
            at: new Date(),
          });
          if (it.fulfillStatus !== status) it.fulfillStatus = status;
          return it;
        });

        // calulate summary store and update FulfillmentInfo
        const summary = computeFulfillmentInfo(
          updated.items.map((x) => ({
            quantity: x.quantity,
            shippedQty: x.shippedQty,
            deliveredQty: x.deliveredQty,
            canceledQty: x.canceledQty,
          })),
          updated.fulfillment,
        );
        updated.fulfillment = {
          ...summary,
          packages: summary.packages,
          shipments: summary.shipments,
          timeline: summary.timeline,
        };

        // สรุประดับร้าน (optional): ถ้าทั้งหมด PACKED/SHIPPED/DELIVERED → set order.status ให้สอดคล้อง
        const allQty = updated.items.reduce((s, x) => s + x.quantity, 0);
        const deliveredQty = updated.items.reduce(
          (s, x) => s + (x.deliveredQty ?? 0),
          0,
        );
        const shippedQty = updated.items.reduce(
          (s, x) => s + (x.shippedQty ?? 0),
          0,
        );
        const packedQty = updated.items.reduce(
          (s, x) => s + (x.packedQty ?? 0),
          0,
        );

        let newStoreStatus = updated.status;
        if (deliveredQty >= allQty) newStoreStatus = "DELIVERED";
        else if (shippedQty >= allQty) newStoreStatus = "SHIPPED";
        else if (packedQty > 0) newStoreStatus = "PACKED";
        else newStoreStatus = "PENDING";

        updated.status = newStoreStatus;
        await updated.save({ session });
      });
    } finally {
      if (session) await session.endSession();
    }

    // ส่งกลับรายละเอียดล่าสุด (ใช้เมธอดที่คุณมีอยู่แล้วจะดีที่สุด)
    return this.getStoreOrderDetail(storeOrderId, storeId);
  }

  async packDelete(storeId: string, storeOrderId: string, packageId: string) {
    const storeIdObj = new Types.ObjectId(storeId);
    const storeOrderIdObj = new Types.ObjectId(storeOrderId);
    const packageIdObj = new Types.ObjectId(packageId);

    const session = await this.conn.startSession();
    try {
      await session.withTransaction(async () => {
        // 1) โหลดออเดอร์
        const order = await this.storeOrderModel
          .findOne({ _id: storeOrderIdObj, storeId: storeIdObj })
          .lean<StoreOrderModelLean>()
          .session(session);

        if (!order) throw new NotFoundException("Store order not found");

        // หา package ตาม id
        const pkg = order.fulfillment?.packages?.find(
          (p) => String(p._id) === String(packageIdObj),
        );
        if (!pkg) throw new NotFoundException("Package not found");

        // 2) ป้องกันเคสลบกล่องที่ถูกใช้งานใน shipment แล้ว
        const usedByShipment = (order.fulfillment?.shipments ?? []).some(
          (sh) =>
            Array.isArray(sh.packageIds) &&
            sh.packageIds.some((id) => String(id) === String(packageIdObj)),
        );
        if (usedByShipment) {
          throw new ForbiddenException(
            "This package is already used by a shipment",
          );
        }

        // 3) รวมยอดที่จะย้อนกลับต่อ SKU (productId+skuId)
        const toReverse = new Map<string, number>(); // key -> qty
        for (const it of pkg.items ?? []) {
          const key = `${String(it.productId)}::${String(it.skuId)}`;
          toReverse.set(key, (toReverse.get(key) ?? 0) + (it.qty ?? 0));
        }

        // ตรวจความถูกต้อง: ห้ามย้อนเกิน packed / shipped
        for (const [key, qty] of toReverse.entries()) {
          const [pid, sid] = key.split("::");
          const row = order.items.find(
            (r) => String(r.productId) === pid && String(r.skuId) === sid,
          );
          if (!row) throw new BadRequestException(`Item not found: ${key}`);

          const packed = row.packedQty ?? 0;
          const shipped = row.shippedQty ?? 0;
          if (qty <= 0)
            throw new BadRequestException(`Invalid qty to un-pack for ${key}`);
          // อย่างน้อยต้องเหลือ packed >= shipped หลังย้อน
          if (packed - qty < shipped) {
            throw new BadRequestException(
              `Cannot delete this package: shipped(${shipped}) would exceed packed(${packed - qty}) for ${key}`,
            );
          }
        }

        // 4) สร้าง $inc (ติดลบ) + arrayFilters สำหรับ items
        const decMap: Record<string, number> = {};
        const filters: any[] = [];
        let i = 0;
        for (const [key, qty] of toReverse.entries()) {
          const [pid, sid] = key.split("::");
          decMap[`items.$[it${i}].packedQty`] = -qty;
          filters.push({
            [`it${i}.productId`]: new Types.ObjectId(pid),
            [`it${i}.skuId`]: new Types.ObjectId(sid),
          });
          i++;
        }

        // 5) อัปเดตรอบแรก: pull package + ลด packedQty + เพิ่ม timeline "unpacked"
        const now = new Date();
        await this.storeOrderModel.updateOne(
          { _id: storeOrderIdObj, storeId: storeIdObj },
          {
            $pull: { "fulfillment.packages": { _id: packageIdObj } },
            $inc: decMap,
            $push: {
              "fulfillment.timeline": {
                type: "store.unpacked",
                at: now,
                by: "Store",
                payload: { packageId: packageIdObj },
              },
            },
          },
          { arrayFilters: filters, session },
        );

        // 6) โหลดกลับมาเพื่อรีคอมพิวต์สถานะ
        const updated = await this.storeOrderModel
          .findOne({ _id: storeOrderIdObj })
          .session(session);
        if (!updated)
          throw new NotFoundException("Store order not found after update");

        // sync fulfillStatus per item (+ บันทึก timeline ของ item)
        updated.items = updated.items.map((it) => {
          const status = computeItemStatus(
            it.quantity,
            it.packedQty ?? 0,
            it.shippedQty ?? 0,
            it.deliveredQty ?? 0,
            it.canceledQty ?? 0,
          );
          it.fulfillTimeline = it.fulfillTimeline ?? [];
          it.fulfillTimeline.push({
            type: "store.unpacked",
            by: "Store",
            at: now,
          });
          if (it.fulfillStatus !== status) it.fulfillStatus = status;
          return it;
        });

        // คำนวณสรุป fulfillment & อัปเดตสถานะร้าน
        const summary = computeFulfillmentInfo(
          updated.items.map((x) => ({
            quantity: x.quantity,
            shippedQty: x.shippedQty,
            deliveredQty: x.deliveredQty,
            canceledQty: x.canceledQty,
          })),
          updated.fulfillment,
        );
        updated.fulfillment = {
          ...summary,
          packages: summary.packages,
          shipments: summary.shipments,
          timeline: summary.timeline,
        };

        const allQty = updated.items.reduce((s, x) => s + x.quantity, 0);
        const deliveredQty = updated.items.reduce(
          (s, x) => s + (x.deliveredQty ?? 0),
          0,
        );
        const shippedQty = updated.items.reduce(
          (s, x) => s + (x.shippedQty ?? 0),
          0,
        );
        const packedQty = updated.items.reduce(
          (s, x) => s + (x.packedQty ?? 0),
          0,
        );

        let newStoreStatus = updated.status;
        if (deliveredQty >= allQty) newStoreStatus = "DELIVERED";
        else if (shippedQty >= allQty) newStoreStatus = "SHIPPED";
        else if (packedQty > 0) newStoreStatus = "PACKED";
        else newStoreStatus = "PENDING";

        updated.status = newStoreStatus;
        await updated.save({ session });
      });
    } finally {
      await session.endSession();
    }

    // ส่งกลับรายละเอียดล่าสุดเหมือน packStoreOrder
    return this.getStoreOrderDetail(storeOrderId, storeId);
  }

  async shipStoreOrder(
    storeId: string,
    storeOrderId: string,
    dto: ShipRequestDto,
  ) {
    const storeIdObj = new Types.ObjectId(storeId);
    const storeOrderIdObj = new Types.ObjectId(storeOrderId);

    const order = await this.storeOrderModel
      .findOne({
        _id: storeOrderIdObj,
        storeId: storeIdObj,
      })
      .lean<StoreOrderModelLean>()
      .exec();

    if (!order) throw new NotFoundException("Store order not found");
    if (order.buyerStatus !== "paid") {
      // ถ้านโยบายอนุญาต ship ก่อน paid ก็ลบเงื่อนไขนี้ได้
      throw new ForbiddenException("Order not paid");
    }

    // 1. Check packages is true
    const ids = dto.packageIds.map((id) => {
      if (!Types.ObjectId.isValid(id)) {
        throw new BadRequestException(`Invalid packageId: ${id}`);
      }
      return new Types.ObjectId(id);
    });

    const packages = (order.fulfillment?.packages ?? []).filter((p) =>
      ids.some((_id) => _id.equals(String(p._id))),
    );

    if (!packages.length) throw new NotFoundException("Packages not found");

    // 2. check packageIds if before not ship (otherwise: double-ship)
    const shippedPakIds = new Set(
      (order.fulfillment?.shipments ?? [])
        .flatMap((s) => s.packageIds ?? [])
        .map((x: Types.ObjectId) => String(x)),
    );
    for (const id of ids) {
      if (shippedPakIds.has(String(id))) {
        throw new BadRequestException(`Package already shipped: ${String(id)}`);
      }
    }

    // 3. sum qty per SKU from packages is chose
    // key = productId::skuId -> sum qty
    const byKeyQty: Record<string, number> = {};
    for (const p of packages) {
      for (const it of p.items ?? []) {
        const key = `${String(it.productId)}::${String(it.skuId)}`;
        byKeyQty[key] = (byKeyQty[key] ?? 0) + (it.qty ?? 0);
      }
    }

    if (!Object.keys(byKeyQty).length) {
      throw new BadRequestException("Selected packages contain no items");
    }

    // 4. check not over outstanding (follow shippedQty)
    // and already incMap + arrayFilters
    const orderItemIndexByKey = new Map<string, number>();
    order.items.forEach((it, idx) => {
      const k = `${String(it.productId)}::${String(it.skuId)}`;
      orderItemIndexByKey.set(k, idx);
    });

    const incMap: Record<string, number> = {};
    const arrayFilters: Record<string, any>[] = [];
    let filterIdx = 0;

    for (const [key, addQty] of Object.entries(byKeyQty)) {
      const idx = orderItemIndexByKey.get(key);
      if (idx === undefined)
        throw new BadRequestException(`Item not found for ${key}`);
      const origin = order.items[idx];

      const qty = origin.quantity || 0;
      const shipped = origin.shippedQty || 0;
      const canceled = origin.canceledQty || 0;
      const outstandingShip = Math.max(0, qty - shipped - canceled);
      if (addQty <= 0) continue;
      if (addQty > outstandingShip) {
        throw new BadRequestException(
          `Ship qty exceed outstanding for ${key} (${addQty} > ${outstandingShip})`,
        );
      }

      // already $inc items.$[itX].shippedQty
      incMap[`items.$[it${filterIdx}].shippedQty`] =
        (incMap[`items.$[it${filterIdx}].shippedQty`] ?? 0) + addQty;

      const [productId, skuId] = key.split("::");
      arrayFilters.push({
        [`it${filterIdx}.productId`]: new Types.ObjectId(productId),
        [`it${filterIdx}.skuId`]: new Types.ObjectId(skuId),
      });
      filterIdx++;
    }

    // 5. already shipment new
    const shippedAtISO = dto.shipment.shippedAt
      ? new Date(dto.shipment.shippedAt)
      : new Date();
    const newShipmentId = new Types.ObjectId();

    const shipmentDoc = {
      _id: newShipmentId,
      carrier: dto.shipment.carrier,
      trackingNumber: dto.shipment.trackingNumber,
      method: dto.shipment.method,
      shippedAt: shippedAtISO,
      packageIds: ids,
      note: dto.shipment.note,
      createdAt: new Date(),
    };

    // create arrayFilter for packages is chose
    const pkgFilters = ids.map((pid, i) => ({ [`p${i}._id`]: pid }));

    // create $set for packages is chose ref this shipment
    const entries: [string, unknown][] = ids.flatMap((pid, i) => [
      [`fulfillment.packages.$[p${i}].shipmentId`, newShipmentId],
      [`fulfillment.packages.$[p${i}].shippedAt`, shippedAtISO],
    ]);
    const setPackageShipmentFields = Object.fromEntries(entries);

    // 6. transaction
    const session = await this.conn.startSession();
    try {
      await session.withTransaction(async () => {
        // 6.1 push shipment + timeline, inc shippedQty
        await this.storeOrderModel.updateOne(
          { _id: storeOrderIdObj, storeId: storeIdObj },
          {
            $push: {
              "fulfillment.shipments": shipmentDoc,
              "fulfillment.timeline": {
                type: "store.shipped",
                at: new Date(),
                by: "Store",
                payload: dto.shipment,
              },
            },
            $set: {
              ...setPackageShipmentFields,
              latestTrackingNo: dto.shipment.trackingNumber,
              shippedAt: shippedAtISO,
            },
            $inc: incMap,
          },
          {
            // merge arrayfilters of items + packages
            arrayFilters: [...arrayFilters, ...pkgFilters],
            session,
          },
        );

        // 6.2 back read in session for sync statuses + summary fulfillment + set StoreOrder.status
        const updated = await this.storeOrderModel
          .findOne({ _id: storeOrderIdObj, storeId: storeIdObj })
          .session(session);
        if (!updated)
          throw new NotFoundException("Store order not found after ship");

        // sync items
        updated.items = updated.items.map((it) => {
          const status = computeItemStatus(
            it.quantity || 0,
            it.packedQty || 0,
            it.shippedQty || 0,
            it.deliveredQty || 0,
            it.canceledQty || 0,
          );
          // add time line in items
          it.fulfillTimeline.push({
            type: "store.shipped",
            by: "Store",
            at: new Date(),
          });
          if (it.fulfillStatus !== status) it.fulfillStatus = status;
          return it;
        });

        // calculate fulfillment (status + counters) โดยคง arrays เดิม
        const totalItems = updated.items.reduce(
          (s, x) => s + (x.quantity || 0),
          0,
        );
        const shippedItems = updated.items.reduce(
          (s, x) => s + (x.shippedQty || 0),
          0,
        );
        const deliveredItems = updated.items.reduce(
          (s, x) => s + (x.deliveredQty || 0),
          0,
        );
        const canceledItems = updated.items.reduce(
          (s, x) => s + (x.canceledQty || 0),
          0,
        );

        let fulfillStatus:
          | "UNFULFILLED"
          | "PARTIALLY_FULFILLED"
          | "FULFILLED"
          | "CANCELED"
          | "RETURNED" = "UNFULFILLED";
        if (canceledItems >= totalItems && totalItems > 0)
          fulfillStatus = "CANCELED";
        else if (deliveredItems >= totalItems && totalItems > 0)
          fulfillStatus = "FULFILLED";
        else if (shippedItems > 0 || deliveredItems > 0)
          fulfillStatus = "PARTIALLY_FULFILLED";
        else fulfillStatus = "UNFULFILLED";

        updated.fulfillment = {
          status: fulfillStatus,
          totalItems,
          shippedItems,
          deliveredItems,
          packages: updated.fulfillment?.packages ?? [],
          shipments: updated.fulfillment?.shipments ?? [],
          timeline: updated.fulfillment?.timeline ?? [],
        };

        // stage view of store
        if (deliveredItems >= totalItems && totalItems > 0)
          updated.status = "DELIVERED";
        else if (shippedItems >= totalItems && totalItems > 0)
          updated.status = "SHIPPED";
        else if (updated.items.reduce((s, x) => s + (x.packedQty || 0), 0) > 0)
          updated.status = "PACKED";
        else updated.status = "PENDING";

        await updated.save({ session });
      });

      // 6.x หลัง TX สำเร็จค่อย publish event (อยู่นอก withTransaction)
      try {
        // สร้าง payload ให้ครบถ้วน และ idempotent ด้วย newShipmentId
        const ev = {
          eventId: `order:${String(order.masterOrderId)}:store:${storeOrderId}:shipment:${String(newShipmentId)}:shipped`,
          occurredAt: new Date().toISOString(),
          buyerId: String(order.buyerId),
          masterOrderId: String(order.masterOrderId),
          storeOrderId: storeOrderId,
          storeId: storeId,
          shipment: {
            shipmentId: String(newShipmentId),
            carrier: dto.shipment.carrier,
            trackingNumber: dto.shipment.trackingNumber,
            method: dto.shipment.method,
            shippedAt: shippedAtISO.toISOString(),
            packageIds: ids.map(String),
            note: dto.shipment.note,
          },
        };

        await this.mq.publishTopic(
          EXCHANGES.ORDERS_EVENTS,
          "orders.shipped",
          ev,
          {
            messageId: ev.eventId, // idempotent
            persistent: true,
          },
        );
      } catch (pubErr) {
        // ไม่ throw ทับผล ship; แค่ log/monitor
        console.log(
          `orders.shipped publish failed: ${(pubErr as Error).message}`,
        );
      }

      return this.getStoreOrderDetail(storeOrderId, storeId);
    } finally {
      await session.endSession();
    }
  }

  async getReports(
    storeId: string,
    range?: { from?: string; to?: string },
  ): Promise<ReportsResponseDto> {
    if (!Types.ObjectId.isValid(storeId)) {
      throw new BadRequestException("Invalid storeId");
    }
    const storeIdObj = new Types.ObjectId(storeId);
    const { start, end } = parseRange(range ?? {});

    // ------- Pipeline ส่วน Summary (รายได้/ออเดอร์/AOV) --------
    const summaryPipe: PipelineStage[] = [
      {
        $match: {
          storeId: storeIdObj,
          buyerStatus: "paid", // นับเฉพาะ paid
          deliveredAt: { $gte: start, $lte: end },
          "items.fulfillStatus": "DELIVERED",
        },
      },
      {
        $group: {
          _id: null,
          // ถ้าฝั่งคุณใช้ pricing.grandTotal เป็นยอดรวมของร้านนั้น ใช้อันนี้:
          revenue: { $sum: { $ifNull: ["$pricing.grandTotal", 0] } },
          orders: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          revenue: 1,
          orders: 1,
          aov: {
            $cond: [
              { $gt: ["$orders", 0] },
              { $divide: ["$revenue", "$orders"] },
              0,
            ],
          },
        },
      },
    ];

    // ------- Pipeline ส่วน Top Products --------
    const topProductsPipe: PipelineStage[] = [
      {
        $match: {
          storeId: storeIdObj,
          buyerStatus: "paid",
          deliveredAt: { $gte: start, $lte: end },
          "items.fulfillStatus": "DELIVERED",
        },
      },
      { $unwind: "$items" },
      {
        $addFields: {
          // 1) packages ที่มี SKU นี้
          _pkgsForItem: {
            $filter: {
              input: { $ifNull: ["$fulfillment.packages", []] },
              as: "p",
              cond: {
                $gt: [
                  {
                    $size: {
                      $filter: {
                        input: { $ifNull: ["$$p.items", []] },
                        as: "pi",
                        cond: { $eq: ["$$pi.skuId", "$items.skuId"] }, // *** ต้องให้ชนิดตรงกัน (ObjectId)
                      },
                    },
                  },
                  0,
                ],
              },
            },
          },
        },
      },
      {
        $addFields: {
          // pull all shipmentId of packages is have this SKU
          _shipmentIdsForItem: {
            $setUnion: {
              $map: { input: "$_pkgsForItem", as: "pp", in: "$$pp.shipmentId" },
            },
          },
        },
      },
      {
        $addFields: {
          // find deliveredAt from shipments at id
          deliveredAtForItem: {
            $max: {
              $map: {
                input: {
                  $filter: {
                    input: { $ifNull: ["$fulfillment.shipments", []] },
                    as: "s",
                    cond: {
                      $and: [
                        { $in: ["$$s._id", "$_shipmentIdsForItem"] },
                        { $ne: ["$$s.deliveredAt", null] },
                      ],
                    },
                  },
                },
                as: "s2",
                in: "$$s2.deliveredAt",
              },
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          productId: { $toString: "$items.productId" },
          skuId: { $toString: "$items.skuId" },
          name: "$items.productName",
          attributes: "$items.attributes",
          fulfillStatus: "$items.fulfillStatus",
          qty: "$items.quantity",
          revenue: {
            $ifNull: [
              "$items.subtotal",
              {
                $multiply: [
                  { $ifNull: ["$items.quantity", 0] },
                  { $ifNull: ["$items.unitPrice", 0] },
                ],
              },
            ],
          },
          deliveredAt: "$deliveredAtForItem",
        },
      },
    ];

    // ยิง 2 pipeline พร้อมกัน
    const [summaryAgg, topAgg] = await Promise.all([
      this.storeOrderModel
        .aggregate<{
          revenue: number;
          orders: number;
          aov: number;
        }>(summaryPipe)
        .exec(),
      this.storeOrderModel
        .aggregate<{
          productId: string;
          skuId: string;
          name: string;
          attributes: Record<string, string>;
          fulfillStatus: FulfillmentStatus;
          qty: number;
          revenue: number;
          deliveredAt: Date;
        }>(topProductsPipe)
        .exec(),
    ]);

    const summary = summaryAgg?.[0] ?? { revenue: 0, orders: 0, aov: 0 };
    const topProducts =
      topAgg.map((p) => ({
        ...p,
        deliveredAt: p.deliveredAt?.toISOString(),
      })) ?? [];
    console.log(topProducts, "topProducts");

    return {
      summary: {
        revenue: Number(summary.revenue || 0),
        orders: Number(summary.orders || 0),
        aov: Number(summary.aov || 0),
      },
      topProducts,
    };
  }
}
