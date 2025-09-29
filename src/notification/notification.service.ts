import { Injectable, Logger } from "@nestjs/common";
import type {
  OrderCreatedEvent,
  OrderPaidEvent,
  OrderShippedEvent,
  OrderDeliveredEvent,
  OrderPaymentFailedEvent,
  OrderPaymentExpiredEvent,
} from "../messaging/mq.events"; // ปรับ path ให้ตรงโปรเจกต์
import { InjectModel } from "@nestjs/mongoose";
import {
  Notification,
  NotificationDocument,
} from "./schemas/notification-schema";
import { Model, Types } from "mongoose";
import { SseBus } from "src/realtime/sse.bus";
import {
  StoreOrder,
  StoreOrderDocument,
} from "src/orders/schemas/store-order.schema";
import { Store, StoreDocument } from "src/store/schemas/store.schema";

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  constructor(
    @InjectModel(Notification.name)
    private readonly notiModel: Model<NotificationDocument>,
    @InjectModel(StoreOrder.name)
    private readonly storeOrderModel: Model<StoreOrderDocument>,
    @InjectModel(Store.name) private readonly storeModel: Model<StoreDocument>,
    private readonly sseBus: SseBus,
  ) {}

  async handleOrderCreated(payload: OrderCreatedEvent): Promise<void> {
    const userIdObj = new Types.ObjectId(payload.buyerId);
    const masterOrderId = payload.masterOrderId;
    const dedupeKey = `orders.created:${masterOrderId}`;

    const res = await this.notiModel.updateOne(
      { userId: userIdObj, dedupeKey },
      {
        $setOnInsert: {
          userId: userIdObj,
          status: "UNREAD",
          type: "ORDER_CREATED",
          title: "คำสั่งซื้อถูกสร้าง",
          body: `คำสั่งซื้อ #${masterOrderId} ของคุณถูกสร้างแล้ว ยอดชำระ ${payload.total} ${payload.currency}`,
          data: {
            masterOrderId,
            paymentMethod: payload.paymentMethod,
            expiresAt: payload.expiresAt,
          },
          dedupeKey,
          eventId: payload.eventId,
          routingKey: "orders.created",
          occurredAt: payload.occurredAt
            ? new Date(payload.occurredAt)
            : undefined,
        } as Partial<Notification>,
      },
      { upsert: true },
    );

    const inserted = !!res.upsertedCount; // ✅ เช็คว่าเพิ่ง insert จริงไหม
    if (inserted) {
      const doc = await this.notiModel
        .findOne({ userId: userIdObj, dedupeKey })
        .lean()
        .exec();

      if (doc) {
        this.sseBus.pushToUser(payload.buyerId, {
          type: "notification",
          payload: doc,
        });
      }
    }

    this.logger.log(
      `Notify order.created -> buyer=${payload.buyerId} order=${masterOrderId}`,
    );
  }

  async handlePaid(payload: OrderPaidEvent): Promise<void> {
    const userIdObj = new Types.ObjectId(payload.buyerId);
    const masterOrderId = payload.masterOrderId;

    const dedupeKey = `orders.paid:${masterOrderId}`;

    const res = await this.notiModel.updateOne(
      { userId: userIdObj, dedupeKey },
      {
        $setOnInsert: {
          userId: userIdObj,
          status: "UNREAD",
          type: "ORDER_PAID",
          title: "ชำระเงินสำเร็จ",
          body: `คำสั่งซื้อ #${masterOrderId} ยอดรวม ${payload.total ?? 0} ${payload.currency?.toLocaleUpperCase() ?? "THB"} ของคุณชำระเรียบร้อย`,
          data: {
            masterOrderId,
            paymentMethod: payload.paymentMethod, // มีไว้ถ้าใส่ใน OrderPaidEvent
            paidAt: payload.paidAt ?? payload.occurredAt,
            paymentIntentId: payload.paymentIntentId, // ใส่ถ้ามีใน event
            chargeId: payload.chargeId, // ใส่ถ้ามีใน event
          },
          dedupeKey,
          eventId: payload.eventId,
          routingKey: "orders.paid", // ✅ แก้เป็น orders.paid
          occurredAt: payload.occurredAt
            ? new Date(payload.occurredAt)
            : undefined,
        } satisfies Partial<Notification>,
      },
      { upsert: true },
    );

    if (res.upsertedCount === 1) {
      const doc = await this.notiModel
        .findOne({ userId: userIdObj, dedupeKey })
        .lean();
      if (doc) {
        console.log(doc, "doc");

        this.sseBus.pushToUser(payload.buyerId, {
          type: "notification",
          payload: doc,
        });
      }
      await this.handleStorePaid(payload);
    }
  }

  // store order in master order
  async handleStorePaid(payload: OrderPaidEvent): Promise<void> {
    const masterOrderId = new Types.ObjectId(payload.masterOrderId);

    // 1) ดึง store orders ของคำสั่งซื้อนี้
    const storeOrders = await this.storeOrderModel
      .find({ masterOrderId })
      .select({ _id: 1, storeId: 1 })
      .lean<{ _id: Types.ObjectId; storeId: Types.ObjectId }[]>()
      .exec();

    if (!storeOrders.length) return;

    // 2) ดึงสมาชิก/เจ้าของร้านทั้งหมดในครั้งเดียว (owner/admin)
    const storeIds = storeOrders.map((s) => s.storeId);
    const members = await this.storeModel
      .find({ _id: { $in: storeIds } })
      .select({ _id: 1, ownerId: 1 })
      .lean<{ _id: Types.ObjectId; ownerId: Types.ObjectId }[]>()
      .exec();

    // map storeId -> userIds
    const byStore: Map<string, string[]> = new Map();
    for (const m of members) {
      const k = String(m._id);
      if (!byStore.has(k)) byStore.set(k, []);
      byStore.get(k)!.push(String(m.ownerId));
    }

    const paidAtIso =
      payload.paidAt ?? payload.occurredAt ?? new Date().toISOString();
    const amount = payload.total ?? 0;
    const currency = (payload.currency ?? "THB").toUpperCase();

    // 3) สร้าง noti ต่อหัวข้อ store order
    for (const so of storeOrders) {
      const storeIdStr = String(so.storeId);
      const storeOrderIdStr = String(so._id);
      const userIds = byStore.get(storeIdStr) ?? [];

      // ไม่มีผู้รับ → ข้าม
      if (!userIds.length) continue;

      const title = "มีคำสั่งซื้อชำระเงินแล้ว";
      const body = `คำสั่งซื้อ #${storeOrderIdStr} ของร้านคุณ ถูกชำระเงินแล้ว ${amount} ${currency}`;

      // upsert per user (idempotent ด้วย dedupeKey)
      await Promise.all(
        userIds.map(async (uid) => {
          const userIdObj = new Types.ObjectId(uid);
          const dedupeKey = `store.orders.paid:${storeOrderIdStr}`;

          await this.notiModel.updateOne(
            { userId: userIdObj, dedupeKey },
            {
              $setOnInsert: {
                userId: userIdObj,
                status: "UNREAD",
                type: "STORE_ORDER_PAID",
                title,
                body,
                data: {
                  masterOrderId: payload.masterOrderId,
                  storeOrderId: storeOrderIdStr,
                  storeId: storeIdStr,
                  paidAt: paidAtIso,
                  paymentMethod: payload.paymentMethod,
                },
                dedupeKey,
                eventId: payload.eventId,
                routingKey: "orders.paid",
                occurredAt: payload.occurredAt
                  ? new Date(payload.occurredAt)
                  : undefined,
              } as Partial<Notification>,
            },
            { upsert: true },
          );

          // ดัน SSE ให้ผู้ใช้คนนั้น
          const doc = await this.notiModel
            .findOne({ userId: userIdObj, dedupeKey })
            .lean();
          if (doc) {
            this.sseBus.pushToUser(uid, { type: "notification", payload: doc });
          }
        }),
      );
    }
  }

  async handleShipped(payload: OrderShippedEvent): Promise<void> {
    const userIdObj = new Types.ObjectId(payload.buyerId);
    const dedupeKey = `orders.shipped:${payload.storeOrderId ?? "master"}`;
    const res = await this.notiModel.updateOne(
      { userId: userIdObj, dedupeKey },
      {
        $setOnInsert: {
          userId: userIdObj,
          status: "UNREAD",
          type: "ORDER_SHIPPED",
          title: "คำสั่งซื้อถูกส่งออกแล้ว",
          body: `พัสดุของคุณถูกส่งด้วย ${payload.shipment.carrier} เลขพัสดุ ${payload.shipment.trackingNumber}`,
          data: {
            masterOrderId: payload.masterOrderId,
            storeOrderId: payload.storeOrderId,
            carrier: payload.shipment.carrier,
            trackingNo: payload.shipment.trackingNumber,
            trackingUrl: payload.shipment.trackingUrl,
          },
          dedupeKey,
          eventId: payload.eventId,
          routingKey: "orders.shipped",
          occurredAt: payload.shipment.shippedAt,
        },
      },
      { upsert: true },
    );

    if (res.upsertedCount === 1) {
      const doc = await this.notiModel
        .findOne({ userId: userIdObj, dedupeKey })
        .lean();
      if (doc)
        this.sseBus.pushToUser(payload.buyerId, {
          type: "notification",
          payload: doc,
        });
    }
  }

  async handleDelivered(payload: OrderDeliveredEvent): Promise<void> {
    const userIdObj = new Types.ObjectId(payload.buyerId);
    const dedupeKey = `orders.delivered:${payload.storeOrderId ?? "master"}`;
    const res = await this.notiModel.updateOne(
      { userId: userIdObj, dedupeKey },
      {
        $setOnInsert: {
          userId: userIdObj,
          status: "UNREAD",
          type: "ORDER_DELIVERED",
          title: "พัสดุถูกจัดส่งเรียบร้อย",
          body: `จัดส่งพัสดุของคุณเรียบร้อย เลขพัสดุ ${payload.shipment.trackingNumber}`,
          data: {
            masterOrderId: payload.masterOrderId,
            storeOrderId: payload.storeOrderId,
            carrier: payload.shipment.carrier,
            trackingNo: payload.shipment.trackingNumber,
            trackingUrl: payload.shipment.trackingUrl,
          },
          dedupeKey,
          eventId: payload.eventId,
          routingKey: "orders.delivered",
          occurredAt: payload.shipment.shippedAt,
        },
      },
      { upsert: true },
    );

    if (res.upsertedCount === 1) {
      const doc = await this.notiModel
        .findOne({ userId: userIdObj, dedupeKey })
        .lean();
      if (doc)
        this.sseBus.pushToUser(payload.buyerId, {
          type: "notification",
          payload: doc,
        });
    }
  }

  // เฉพาะถ้าคุณจะใช้เหตุการณ์ล้มเหลว/หมดอายุในระดับ order
  async handlePaymentFailed(payload: OrderPaymentFailedEvent): Promise<void> {
    this.logger.log(
      `Notify order.payment_failed -> buyer=${payload.buyerId} order=${payload.masterOrderId}`,
    );
    // ...
  }

  async handlePaymentExpired(payload: OrderPaymentExpiredEvent): Promise<void> {
    const userIdObj = new Types.ObjectId(payload.buyerId);
    const dedupeKey = `orders.payment_expired:${payload.masterOrderId}`;

    const res = await this.notiModel.updateOne(
      { userId: userIdObj, dedupeKey },
      {
        $setOnInsert: {
          userId: userIdObj,
          status: "UNREAD",
          type: "ORDER_PAYMENT_EXPIRED",
          title: "การชำระเงินหมดเวลา",
          body: `คำสั่งซื้อ #${payload.masterOrderId} หมดเวลาชำระ (${payload.reason ?? "payment_timeout"})`,
          data: {
            masterOrderId: payload.masterOrderId,
            paymentIntentId: payload.paymentIntentId,
          },
          dedupeKey,
          eventId: payload.eventId,
          routingKey: "orders.payment_expired",
          occurredAt: payload.occurredAt
            ? new Date(payload.occurredAt)
            : undefined,
        },
      },
      { upsert: true },
    );

    if (res.upsertedCount === 1) {
      const doc = await this.notiModel
        .findOne({ userId: userIdObj, dedupeKey })
        .lean();
      if (doc)
        this.sseBus.pushToUser(payload.buyerId, {
          type: "notification",
          payload: doc,
        });
    }
  }
}
