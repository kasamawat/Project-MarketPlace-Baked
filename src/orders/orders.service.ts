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
  computeListStatusBuyer,
  computeListStatusMaster,
  ensureOwnershipMaster,
  PayCoreStatus,
} from "./utils/orders-helper";
import { PaymentsService } from "src/payments/payments.service";
import { UpdateFilter } from "mongodb";
import { PayMetaOut } from "./types/order.types";
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
  storesSummary,
} from "./types/buyer-order.types";
import {
  Reservation,
  ReservationDocument,
} from "src/inventory/schemas/reservation.schema";
import { STRIPE_CLIENT } from "src/payments/constants";
import Stripe from "stripe";
import {
  StoreOrderDetailItem,
  StoreOrderFacet,
} from "./types/store-order.types";
import { StoreListItemDto } from "./dto/store-order-list.dto";

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
    const ttlMinutes = 10; // default 20
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
                  status: "pending_payment",
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
      .select({ _id: 1, itemsCount: 1, status: 1 })
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
        status: { $in: ["pending_payment", "paying", "processing"] },
      };

      const initRes = await this.storeOrderModel
        .updateOne(
          baseFilter,
          [
            {
              $set: {
                status: "paid",
                updatedAt: now,
                // init เฉพาะที่ยังไม่มี
                "fulfillment.status": {
                  $ifNull: ["$fulfillment.status", "UNFULFILLED"],
                },
                "fulfillment.shippedItems": {
                  $ifNull: ["$fulfillment.shippedItems", 0],
                },
                "fulfillment.deliveredItems": {
                  $ifNull: ["$fulfillment.deliveredItems", 0],
                },
                "fulfillment.totalItems": {
                  $ifNull: ["$fulfillment.totalItems", s.itemsCount ?? 0],
                },
                "fulfillment.timeline": {
                  $ifNull: ["$fulfillment.timeline", []],
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
        { masterOrderId: _id, status: { $in: ["pending_payment"] } },
        {
          $set: { status: "canceled", "items.$[it].fulfillStatus": "CANCELED" },
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

    if (res.matchedCount === 0) return; // idempotent for other statuses

    await this.storeOrderModel
      .updateMany(
        { masterOrderId: _id, status: { $in: ["pending_payment"] } },
        {
          $set: { status: "expired", "items.$[it].fulfillStatus": "CANCELED" },
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

    // map status filter
    const filter: Record<string, any> = { buyerId: userIdObj };
    if (q.status && q.status !== "all") {
      switch (q.status) {
        case "paid":
        case "expired":
        case "canceled":
        case "pending_payment":
          filter.status = q.status;
          break;
        case "paying":
          filter.status = "pending_payment";
          filter["payment.status"] = "requires_action";
          break;
        case "processing":
          filter.status = "pending_payment";
          filter["payment.status"] = "processing";
          break;
      }
    }

    // pipeline: Master → lookup StoreOrders → flatten items → preview 2 ชิ้น
    const pipeline: import("mongoose").PipelineStage[] = [
      { $match: filter },
      { $sort: { createdAt: -1 as 1 | -1 } },

      // 1) ดึง StoreOrders ทั้งก้อน พร้อมชื่อร้าน + items ที่ต้องใช้
      {
        $lookup: {
          from: "storeorders",
          let: { mid: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$masterOrderId", "$$mid"] } } },
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
            // เก็บ field ที่ต้องใช้ต่อทั้งหมด (รวม items)
            {
              $project: {
                _id: 1,
                storeId: 1,
                storeName: "$storeDoc.name",
                storeStatus: "$status",
                items: 1, // ← ใช้ทั้ง summary และ preview
              },
            },
          ],
          as: "sos", // store orders (rich)
        },
      },

      // 2) คำนวณ storesSummary จาก sos
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
                // total item in store
                itemsCount: {
                  $sum: {
                    $map: {
                      input: { $ifNull: ["$$so.items", []] },
                      as: "it",
                      in: { $ifNull: ["$$it.quantity", 0] },
                    },
                  },
                },
                // total price in store
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
                // preview item in store
                itemsPreview: {
                  $slice: [
                    {
                      $map: {
                        input: { $ifNull: ["$$so.items", []] },
                        as: "it",
                        in: {
                          name: "$$it.productName",
                          qty: "$$it.quantity",
                          image: "$$it.productImage",
                          attributes: "$$it.attributes",
                          fulfillStatus: "$$it.fulfillStatus",
                        },
                      },
                    },
                    3,
                  ],
                },
              },
            },
          },
        },
      },

      // 3) รวม items จากทุก store เพื่อทำ preview / totals (fallback ถ้า master ไม่มีเก็บ)
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
          itemsPreview: {
            $slice: [
              {
                $map: {
                  input: "$allItems",
                  as: "it",
                  in: {
                    name: "$$it.productName",
                    qty: "$$it.quantity",
                    image: "$$it.productImage",
                    attributes: "$$it.attributes",
                  },
                },
              },
              3,
            ],
          },
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

      // 4) เตรียมฟิลด์ list + payment.status สำหรับ map เป็น userStatus
      {
        $project: {
          _id: 1,
          createdAt: 1,
          currency: 1,
          itemsPreview: 1,
          itemsCount: { $ifNull: ["$itemsCount", "$itemsCountCalc"] },
          itemsTotal: { $ifNull: ["$pricing.itemsTotal", "$itemsTotalCalc"] },
          reservationExpiresAt: 1,
          status: 1,
          payment: { status: "$payment.status" },
          storesSummary: 1,
        },
      },

      // 5) facet → data + total
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
      itemsPreview: m.itemsPreview ?? [],
      itemsCount: m.itemsCount ?? 0,
      itemsTotal: m.itemsTotal ?? 0,
      currency: m.currency ?? "THB",
      userStatus: computeListStatusBuyer({
        status: m.status as PayCoreStatus,
        payment: m.payment,
      }), // ใช้ master.status + payment.status + (optionally) storesSummary
      reservationExpiresAt: m.reservationExpiresAt?.toISOString?.(),
      storesSummary: m.storesSummary.map((s: storesSummary) => ({
        storeOrderId: String(s.storeOrderId),
        storeId: String(s.storeId),
        storeName: s.storeName ?? "",
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

    const pipeline: import("mongoose").PipelineStage[] = [
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
      userStatus: computeListStatusMaster(facet),
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
        status: s.status,
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

    const pipeline: import("mongoose").PipelineStage[] = [
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
            {
              $project: {
                _id: 1,
                storeId: 1,
                status: 1,
                pricing: 1,
                items: {
                  $map: {
                    input: "$items",
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
      userStatus: computeListStatusMaster(facet),
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
        status: s.status,
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

  // ================================= Method Claim =================================
  // ดึง 1 ออเดอร์ที่ “หมดเวลา” แล้ว claim ไว้กันชนกัน
  // async claimOneExpired(
  //   now = new Date(),
  //   workerId = "reaper",
  // ): Promise<OrderDocument | null> {
  //   return this.orderModel
  //     .findOneAndUpdate(
  //       {
  //         status: { $in: ["pending_payment", "paying", "processing"] },
  //         reservationExpiresAt: { $lte: now },
  //         $or: [
  //           { expiryClaimedAt: { $exists: false } },
  //           { expiryClaimedAt: null },
  //         ],
  //       },
  //       { $set: { expiryClaimedAt: now, expiryClaimedBy: workerId } },
  //       { new: true },
  //     )
  //     .lean<OrderDocument>()
  //     .exec();
  // }

  // (เผื่อ) ล้าง claim กรณีทำไม่สำเร็จ
  // async clearClaim(
  //   masterOrderId: string,
  //   session?: ClientSession,
  // ): Promise<void> {
  //   await this.orderModel
  //     .updateOne(
  //       { _id: new Types.ObjectId(masterOrderId) },
  //       { $unset: { expiryClaimedAt: 1, expiryClaimedBy: 1 } },
  //       { session },
  //     )
  //     .exec();
  // }

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

    // -------- parse payStatus (StoreOrder.status) ----------
    // q.payStatus: "paid" | "pending_payment" | "canceled" | "expired" | "all"
    const payStatuses =
      q.payStatus && q.payStatus !== "all"
        ? q.payStatus
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : null;

    // -------- parse fulfillStatus (ต่อ item) ----------
    // รองรับ "UNFULFILLED" ให้ขยายเป็น ["PENDING","PACKED"]
    const rawFulfill =
      q.fulfillStatus && q.fulfillStatus !== "all"
        ? q.fulfillStatus
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    const expanded = new Set<string>();
    for (const s of rawFulfill) {
      if (s === "UNFULFILLED") {
        expanded.add("PENDING");
        expanded.add("PACKED");
      } else {
        expanded.add(s);
      }
    }
    const fulfillArray = Array.from(expanded); // [] = ไม่กรอง

    // --------- $match ระดับเอกสาร StoreOrder ----------
    const topMatch: Record<string, any> = { storeId: storeIdObj };
    if (payStatuses?.length) {
      topMatch.status =
        payStatuses.length > 1 ? { $in: payStatuses } : payStatuses[0];
    }

    // --------- Pipeline ----------
    const pipeline: PipelineStage[] = [
      { $match: topMatch },
      { $sort: { createdAt: -1 as 1 | -1 } },

      // add usen, email buyer
      {
        $lookup: {
          from: "users",
          let: { uid: "$buyerId" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [{ $eq: ["$_id", "$$uid"] }],
                },
              },
            },
            {
              $project: {
                _id: 1,
                username: 1,
                email: 1,
              },
            },
          ],
          as: "buyer",
        },
      },
      { $set: { buyer: { $first: "$buyer" } } },

      // ถ้ามี fulfill filter → สร้างฟิลด์ filtered เป็น items ที่ผ่านเงื่อนไข
      // ถ้าไม่มี filter → ให้ filtered = items ทั้งหมด (เพื่อคำนวณ/preview)
      {
        $set: {
          filtered: fulfillArray.length
            ? {
                $filter: {
                  input: "$items",
                  as: "it",
                  cond: { $in: ["$$it.fulfillStatus", fulfillArray] },
                },
              }
            : "$items",
        },
      },

      // ถ้ามี fulfill filter → ตัดเอกสารที่ไม่มี item ตรงเงื่อนไขออก
      ...(fulfillArray.length
        ? ([
            { $match: { $expr: { $gt: [{ $size: "$filtered" }, 0] } } },
          ] as PipelineStage[])
        : ([] as PipelineStage[])),

      // คำนวณจำนวน/ยอด + ทำ preview
      {
        $addFields: {
          itemsCount: {
            $sum: { $map: { input: "$filtered", as: "f", in: "$$f.quantity" } },
          },
          itemsTotal: {
            $sum: { $map: { input: "$filtered", as: "f", in: "$$f.subtotal" } },
          },
          itemsPreview: {
            $slice: [
              {
                $map: {
                  input: "$filtered",
                  as: "it",
                  in: {
                    name: "$$it.productName",
                    qty: "$$it.quantity",
                    attributes: "$$it.attributes",
                    fulfillStatus: "$$it.fulfillStatus",
                  },
                },
              },
              2, // แสดงตัวอย่าง 2 ชิ้น
            ],
          },
        },
      },

      {
        $project: {
          _id: 1,
          masterOrderId: 1,
          createdAt: 1,
          currency: 1,
          status: 1, // pay-status ของ store order
          pricingGrandTotal: "$pricing.grandTotal",
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

    const items: StoreOrderDetailItem[] = (facet?.data ?? []).map((o) => ({
      masterOrderId: String(o.masterOrderId),
      storeOrderId: String(o._id),
      createdAt: o.createdAt?.toISOString?.() ?? new Date().toISOString(),
      itemsPreview: o.itemsPreview ?? [],
      itemsCount: o.itemsCount ?? 0,
      itemsTotal: o.itemsTotal ?? 0,
      currency: o.currency,
      status: o.status,
      fulfillment: o.fulfillment,
      buyer: o.buyer,
    }));

    const total = facet?.total?.[0]?.count ?? 0;
    return { items, total };
  }
}
