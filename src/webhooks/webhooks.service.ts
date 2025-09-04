// src/webhooks/webhooks.service.ts
import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectConnection, InjectModel } from "@nestjs/mongoose";
import { ClientSession, Connection, Model, Types } from "mongoose";
import { CarrierWebhookDto } from "./dto/carrier-webhook.dto";
import * as crypto from "crypto";
import {
  StoreOrder,
  StoreOrderDocument,
} from "src/orders/schemas/store-order.schema";
import { StoreOrderModelLean } from "src/orders/types/store-order-model";
import {
  CarrierWebhookEvent,
  CarrierWebhookEventDocument,
} from "./schemas/carrier-webhook-event.schema";
import Stripe from "stripe";
import { STRIPE_CLIENT } from "src/payments/constants";
import {
  PaymentEvent,
  PaymentEventDocument,
} from "src/payments/schemas/payment-event.schema";
import { MQ_PUBLISHER } from "src/messaging/mq.tokens";
import { MqPublisher } from "src/messaging/mq.types";
import { OrdersService } from "src/orders/orders.service";
import { InventoryService } from "src/inventory/inventory.service";
import { EXCHANGES } from "src/messaging/mq.topology";
import {
  PaymentWebhookEvent,
  PaymentWebhookEventDocument,
} from "./schemas/payment-webhook-event.schema";
import { PendingEvent } from "./types/webhooks-payment.types";

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    @InjectConnection() private readonly conn: Connection,
    @InjectModel(StoreOrder.name)
    private readonly storeOrderModel: Model<StoreOrderDocument>,

    @InjectModel(PaymentWebhookEvent.name)
    private readonly paymentWebhookEventModel: Model<PaymentWebhookEventDocument>,

    @InjectModel(CarrierWebhookEvent.name)
    private readonly carrierWebhookEventModel: Model<CarrierWebhookEventDocument>,

    @Inject(forwardRef(() => OrdersService))
    private readonly orders: OrdersService,

    private readonly inventory: InventoryService,

    @Inject(MQ_PUBLISHER) private readonly mq: MqPublisher,

    @InjectModel(PaymentEvent.name)
    private readonly paymentEventModel: Model<PaymentEventDocument>,

    @InjectConnection() private readonly connection: Connection,
  ) {}

  // ========== Security ==========
  private secrets: Record<string, string> = {
    "th-ems": process.env.CARRIER_EMS_SECRET!,
    "th-kerry": process.env.CARRIER_KERRY_SECRET!,
    "th-thunder": process.env.CARRIER_THUNDER_SECRET!,
    "th-easy": process.env.CARRIER_EASY_SECRET!,
    // ..
  };
  // =============================================================================================================================================
  // ============================================================ Webhook For Payment ============================================================
  // =============================================================================================================================================
  verifyAndParseWebhook(rawBody: Buffer, signature: string, secret: string) {
    try {
      return this.stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Invalid signature";
      this.logger.warn(`Stripe verify failed: ${msg}`);
      throw new BadRequestException("Invalid Stripe signature");
    }
  }
  private async alreadyHandled(event: Stripe.Event): Promise<boolean> {
    const existed = await this.paymentEventModel
      .exists({ id: event.id })
      .lean();
    if (existed) return true;
    await this.paymentEventModel.create({
      id: event.id,
      type: event.type,
      createdAt: new Date((event.created ?? Date.now() / 1000) * 1000),
    });
    return false;
    // แนะนำให้มี unique index: { id: 1 }, unique:true
  }

  /** ดึง masterOrderId จาก metadata */
  private getMasterIdFromEvent(event: Stripe.Event): string | undefined {
    if (!event.type.startsWith("payment_intent.")) return undefined;
    const obj = event.data.object as Stripe.PaymentIntent;
    return obj?.metadata?.masterOrderId;
  }

  /** Mark handled inside TX (upsert) */
  async markHandled(
    event: Stripe.Event,
    session?: ClientSession,
  ): Promise<void> {
    const payload = {
      eventId: event.id,
      provider: "stripe" as const,
      type: event.type,
      masterOrderId: this.getMasterIdFromEvent(event),
      handledAt: new Date(),
      receivedAt:
        typeof event.created === "number"
          ? new Date(event.created * 1000)
          : undefined,
    };
    try {
      await this.paymentWebhookEventModel
        .updateOne(
          { eventId: event.id },
          { $setOnInsert: payload },
          { upsert: true, session },
        )
        .exec();
    } catch (err: any) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (err?.code === 11000) return;
      throw err;
    }
  }

  // ============================== Handle Stripe Events (Master) ==============================
  async handleEvent(event: Stripe.Event): Promise<void> {
    if (await this.alreadyHandled(event)) {
      this.logger.debug(`Skip duplicate event ${event.id} (${event.type})`);
      return;
    }
    if (!event.type.startsWith("payment_intent.")) {
      this.logger.debug(`Ignore non-PI event: ${event.type}`);
      return;
    }

    const pi = event.data.object as Stripe.PaymentIntent;
    const masterOrderId = this.getMasterIdFromEvent(event);
    if (!masterOrderId) {
      this.logger.warn("Missing masterOrderId in metadata");
      return;
    }
    if (!Types.ObjectId.isValid(masterOrderId)) {
      this.logger.error(`Invalid masterOrderId: ${masterOrderId}`);
      return;
    }

    const pendingEvents: PendingEvent[] = [];
    const session = await this.connection.startSession();

    try {
      await session.withTransaction(async () => {
        switch (event.type) {
          case "payment_intent.processing": {
            await this.orders.markMasterPaying(
              masterOrderId,
              {
                paymentIntentId: pi.id,
                provider: "stripe",
                amount: (pi.amount ?? 0) / 100,
                currency: (pi.currency ?? "thb").toUpperCase(),
              },
              session,
            );

            pendingEvents.push({
              exchange: EXCHANGES.PAYMENTS_EVENTS,
              routingKey: "payments.processing",
              payload: {
                masterOrderId,
                paymentIntentId: pi.id,
                at: new Date().toISOString(),
              },
              options: {
                messageId: `stripe:${event.id}:processing`,
                persistent: true,
              },
            });
            break;
          }

          case "payment_intent.succeeded": {
            // ตัด reservation ระดับ Master
            await this.inventory.commitReservationByMaster(
              masterOrderId,
              { reason: "stripe_succeeded", referenceId: pi.id },
              session,
            );

            const chargeId =
              typeof pi.latest_charge === "string"
                ? pi.latest_charge
                : pi.latest_charge?.id;

            await this.orders.markMasterPaid(
              masterOrderId,
              {
                paymentIntentId: pi.id,
                chargeId,
                amount:
                  typeof pi.amount_received === "number"
                    ? pi.amount_received / 100
                    : (pi.amount ?? 0) / 100,
                currency: (pi.currency ?? "thb").toUpperCase(),
              },
              session,
            );

            // ===== not test =====
            // tranfer money to store
            // await this.orders.transfersToStores(masterOrderId, session);

            // Clear Cart After Paid
            await this.orders.finalizeCartAfterPaid(masterOrderId, session);

            pendingEvents.push(
              //1) payment event
              {
                exchange: EXCHANGES.PAYMENTS_EVENTS,
                routingKey: "payments.succeeded",
                payload: {
                  masterOrderId,
                  paymentIntentId: pi.id,
                  chargeId,
                  at: new Date().toISOString(),
                },
                options: {
                  messageId: `stripe:${event.id}:succeeded`,
                  persistent: true,
                },
              },
              // 2) domain order event
              {
                exchange: EXCHANGES.ORDERS_EVENTS,
                routingKey: "orders.master.paid",
                payload: {
                  masterOrderId,
                  paymentIntentId: pi.id,
                  chargeId,
                  amount:
                    typeof pi.amount_received === "number"
                      ? pi.amount_received / 100
                      : (pi.amount ?? 0) / 100,
                  currency: (pi.currency ?? "thb").toUpperCase(),
                  at: new Date().toISOString(),
                },
                options: {
                  messageId: `master:${masterOrderId}:paid:${Date.now()}`,
                  persistent: true,
                },
              },
            );

            break;
          }

          case "payment_intent.payment_failed":
          case "payment_intent.canceled": {
            await this.inventory.releaseByMaster(masterOrderId, session);

            const reason =
              event.type === "payment_intent.canceled"
                ? (pi.cancellation_reason ?? "canceled")
                : (pi.last_payment_error?.message ?? "payment_failed");

            await this.orders.markMasterCanceled(
              masterOrderId,
              { paymentIntentId: pi.id, reason },
              session,
            );

            pendingEvents.push(
              // payment event
              {
                exchange: EXCHANGES.PAYMENTS_EVENTS,
                routingKey: "payments.canceled",
                payload: {
                  masterOrderId,
                  paymentIntentId: pi.id,
                  error: pi.last_payment_error?.message,
                  at: new Date().toISOString(),
                },
                options: {
                  messageId: `stripe:${event.id}:failed`,
                  persistent: true,
                },
              },
              // domain order event
              {
                exchange: EXCHANGES.ORDERS_EVENTS,
                routingKey: "orders.master.canceled",
                payload: {
                  masterOrderId,
                  reason:
                    event.type === "payment_intent.canceled"
                      ? (pi.cancellation_reason ?? "canceled")
                      : (pi.last_payment_error?.message ?? "payment_failed"),
                  at: new Date().toISOString(),
                },
                options: {
                  messageId: `master:${masterOrderId}:canceled:${Date.now()}`,
                  persistent: true,
                },
              },
            );
            break;
          }

          default:
            this.logger.debug(`Unhandled PI event: ${event.type}`);
            break;
        }

        await this.markHandled(event, session);
      });
    } catch (err) {
      this.logger.error(`Stripe event error: ${(err as Error)?.message}`);
    } finally {
      await session.endSession();
    }

    // Publish หลัง commit
    for (const ev of pendingEvents) {
      await this.mq.publishTopic(
        ev.exchange,
        ev.routingKey,
        ev.payload,
        ev.options,
      );
    }
  }

  // =============================================================================================================================================
  // ============================================================ Webhook For Carrier ============================================================
  // =============================================================================================================================================
  verifySignature(
    carrierCode: string,
    rawBody: string,
    ts: string,
    sig: string | undefined,
  ): boolean {
    if (!sig || !ts) return false;
    const secret = this.secrets[carrierCode.toLowerCase()];
    if (!secret) return false;

    // ตรวจ timestamp สั้น ๆ
    const now = Date.now();
    const t = Number(ts) || Date.parse(ts);
    const test = Date.now() + t;
    // if (!t || Math.abs(now - t) > 5 * 60 * 1000) return false;
    if (!t || Math.abs(now - test) > 5 * 60 * 1000) return false;

    const h = crypto
      .createHmac("sha256", secret)
      .update(rawBody + ts)
      .digest("hex");
    console.log(h,"H");
    return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(sig));
  }

  // ========== Process ==========
  async processCarrierEvent(
    carrierCode: string,
    dto: CarrierWebhookDto,
    idemKey?: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ts?: string,
  ) {
    // 1) idempotency: upsert event record (unique eventId)
    try {
      await this.carrierWebhookEventModel.create({
        source: "carrier",
        carrier: carrierCode,
        eventId: dto.eventId,
        idemKey: idemKey ?? null,
        receivedAt: new Date(),
        payload: dto,
      });
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (e?.code === 11000) {
        // duplicate eventId → ถือว่าสำเร็จไปแล้ว
        return;
      }
      throw e;
    }

    // 2) process only events we care
    if (
      dto.event !== "delivered" &&
      dto.event !== "returned" &&
      dto.event !== "failed"
    ) {
      // in_transit/out_for_delivery → อาจอัปเดต timeline ได้ แต่ไม่บังคับ
      return;
    }

    // 3) find store order by tracking (ภายใต้ fulfillment.shipments)
    const order = await this.storeOrderModel
      .findOne({
        "fulfillment.shipments.trackingNumber": dto.trackingNumber,
        ...(dto.carrier
          ? { "fulfillment.shipments.carrier": dto.carrier }
          : {}),
      })
      .lean<StoreOrderModelLean>()
      .exec();
    if (!order) throw new NotFoundException("Order for tracking not found");

    // หา shipment ที่ตรง tracking
    const shipment = (order.fulfillment?.shipments ?? []).find(
      (s) =>
        s.trackingNumber === dto.trackingNumber &&
        (!dto.carrier || s.carrier === dto.carrier),
    );
    if (!shipment) throw new NotFoundException("Shipment not found");

    // ถ้า delivered มาก่อนแล้ว → idempotent
    if (shipment.deliveredAt && dto.event === "delivered") return;

    // 4) ทำใน transaction
    const session = await this.conn.startSession();
    try {
      await session.withTransaction(async () => {
        // 4.1 Mark shipment delivered/returned
        if (dto.event === "delivered") {
          shipment.deliveredAt = dto.eventAt
            ? new Date(dto.eventAt)
            : new Date();
        } else if (dto.event === "returned") {
          shipment.returnedAt = dto.eventAt
            ? new Date(dto.eventAt)
            : new Date();
        } else if (dto.event === "failed") {
          shipment.failedAt = dto.eventAt ? new Date(dto.eventAt) : new Date();
        }

        // 4.2 เพิ่ม deliveredQty ต่อ item ตาม packages ใน shipment
        // สมมติ shipment.packageIds อ้าง packages และแต่ละ package มี items: [{productId, skuId, qty}]
        const incMap: Record<string, number> = {};
        const arrayFilters: Record<string, any>[] = [];
        let idx = 0;

        if (dto.event === "delivered") {
          const pkgIds: Types.ObjectId[] = shipment.packageIds ?? [];
          const pkgs = (order.fulfillment?.packages ?? []).filter((p) =>
            pkgIds.some((_id) => String(_id) === String(p._id)),
          );

          // รวม qty ต่อ sku
          const byKey: Record<string, number> = {};
          for (const p of pkgs) {
            for (const it of p.items ?? []) {
              const key = `${String(it.productId)}::${String(it.skuId)}`;
              byKey[key] = (byKey[key] ?? 0) + (it.qty ?? 0);
            }
          }

          // จำกัดไม่ให้เกิน outstanding delivered
          const mapIndexByKey = new Map<string, number>();
          order.items.forEach((it, i: number) => {
            const k = `${String(it.productId)}::${String(it.skuId)}`;
            mapIndexByKey.set(k, i);
          });

          for (const [key, addQty] of Object.entries(byKey)) {
            const i = mapIndexByKey.get(key);
            if (i == null) continue;
            const it = order.items[i];
            const qty = it.quantity || 0;
            const delivered = it.deliveredQty || 0;
            const canceled = it.canceledQty || 0;
            const outstanding = Math.max(0, qty - delivered - canceled);
            const inc = Math.max(0, Math.min(addQty, outstanding));
            if (inc <= 0) continue;

            incMap[`items.$[it${idx}].deliveredQty`] = inc;
            arrayFilters.push({
              [`it${idx}.productId`]: it.productId,
              [`it${idx}.skuId`]: it.skuId,
            });
            idx++;
          }
        }

        // 4.3 update DB
        await this.storeOrderModel.updateOne(
          { _id: order._id },
          {
            ...(dto.event === "delivered"
              ? {
                  $set: {
                    "fulfillment.shipments.$[s].deliveredAt":
                      shipment.deliveredAt,
                    deliveredAt: shipment.deliveredAt, // summary สำหรับ list view (optional)
                  },
                  $inc: incMap,
                  $push: {
                    "fulfillment.timeline": {
                      type: "store.delivered",
                      at: shipment.deliveredAt,
                      by: "Carrier",
                      payload: dto,
                    },
                  },
                }
              : dto.event === "returned"
                ? {
                    $set: {
                      "fulfillment.shipments.$[s].returnedAt":
                        shipment.returnedAt,
                    },
                    $push: {
                      "fulfillment.timeline": {
                        type: "store.returned",
                        at: shipment.returnedAt,
                        by: "Carrier",
                      },
                    },
                  }
                : {
                    $set: {
                      "fulfillment.shipments.$[s].failedAt": shipment.failedAt,
                    },
                    $push: {
                      "fulfillment.timeline": {
                        type: "store.ship-failed",
                        at: shipment.failedAt,
                        by: "Carrier",
                      },
                    },
                  }),
          },
          {
            arrayFilters: [
              {
                "s.trackingNumber": dto.trackingNumber,
                ...(dto.carrier ? { "s.carrier": dto.carrier } : {}),
              },
              ...arrayFilters,
            ],
            session,
          },
        );

        // 4.4 อ่านกลับมาเพื่อคำนวณ summary/stage
        const fresh = await this.storeOrderModel
          .findById(order._id)
          .session(session);
        if (!fresh) throw new NotFoundException();

        // sync รายการ
        fresh.items = fresh.items.map((it) => {
          const qty = it.quantity || 0;
          const packed = it.packedQty || 0;
          const shipped = it.shippedQty || 0;
          const delivered = it.deliveredQty || 0;
          const canceled = it.canceledQty || 0;

          let next = it.fulfillStatus;
          if (canceled >= qty) next = "CANCELED";
          else if (delivered >= qty) next = "DELIVERED";
          else if (shipped >= qty) next = "SHIPPED";
          else if (packed >= qty) next = "PACKED";
          else if (packed > 0) next = "PENDING";
          else next = "PENDING";
          if (it.fulfillStatus !== next) it.fulfillStatus = next;
          return it;
        });

        // สรุป fulfillment summary
        const totalItems = fresh.items.reduce(
          (s: number, x) => s + (x.quantity || 0),
          0,
        );
        const shippedItems = fresh.items.reduce(
          (s: number, x) => s + (x.shippedQty || 0),
          0,
        );
        const deliveredItems = fresh.items.reduce(
          (s: number, x) => s + (x.deliveredQty || 0),
          0,
        );
        const canceledItems = fresh.items.reduce(
          (s: number, x) => s + (x.canceledQty || 0),
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

        fresh.fulfillment = {
          status: fulfillStatus,
          totalItems,
          shippedItems,
          deliveredItems,
          packages: fresh.fulfillment?.packages ?? [],
          shipments: fresh.fulfillment?.shipments ?? [],
          timeline: fresh.fulfillment?.timeline ?? [],
        };

        // อัปเดต stage view
        if (deliveredItems >= totalItems && totalItems > 0)
          fresh.status = "DELIVERED";
        else if (shippedItems >= totalItems && totalItems > 0)
          fresh.status = "SHIPPED";
        else if (
          fresh.items.reduce((s: number, x) => s + (x.packedQty || 0), 0) > 0
        )
          fresh.status = "PACKED";
        else fresh.status = "PENDING";

        await fresh.save({ session });
      });
    } finally {
      await session.endSession();
    }
  }
}
