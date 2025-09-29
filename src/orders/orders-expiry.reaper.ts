// src/orders/orders-expiry.reaper.ts
import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectConnection, InjectModel } from "@nestjs/mongoose";
import { Connection, Model, Types } from "mongoose";
import Stripe from "stripe";

import { OrdersService } from "./orders.service";
import { InventoryService } from "src/inventory/inventory.service";
import { STRIPE_CLIENT } from "src/payments/constants";
import { MQ_PUBLISHER } from "src/messaging/mq.tokens";
import { MqPublisher } from "src/messaging/mq.types";
import { EXCHANGES } from "src/messaging/mq.topology";
import { Cron, CronExpression } from "@nestjs/schedule";
import {
  MasterOrder,
  MasterOrderDocument,
} from "./schemas/master-order.schema";
import { runTxnWithRetry } from "./utils/orders-expiry-helper";

const BATCH = Number(process.env.ORDER_EXPIRY_BATCH || 50);

@Injectable()
export class OrdersExpiryReaper {
  private readonly logger = new Logger(OrdersExpiryReaper.name);

  constructor(
    @InjectModel(MasterOrder.name)
    private readonly masterOrderModel: Model<MasterOrderDocument>,
    private readonly orders: OrdersService,
    private readonly inventory: InventoryService,
    @InjectConnection() private readonly conn: Connection,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    @Inject(MQ_PUBLISHER) private readonly mq: MqPublisher,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async sweep() {
    const now = new Date();
    let processed = 0;

    while (true) {
      const list = await this.masterOrderModel
        .find({
          status: "pending_payment",
          reservationExpiresAt: { $lte: now },
          $or: [{ expiring: { $exists: false } }, { expiring: false }],
        })
        .select(
          "_id buyerId paymentIntentId paymentProvider reservationExpiresAt currency pricing",
        )
        .sort({ reservationExpiresAt: 1 })
        .limit(BATCH)
        .lean<
          {
            _id: Types.ObjectId;
            buyerId: Types.ObjectId;
            paymentIntentId?: string;
            paymentProvider?: string;
            reservationExpiresAt: Date;
            currency: string;
            pricing: Record<string, string>;
          }[]
        >();

      if (!list.length) break;

      for (const it of list) {
        const masterOrderId = String(it._id);

        // 0) claim กันชนกันก่อน
        const claimed = await this.masterOrderModel
          .findOneAndUpdate(
            {
              _id: it._id,
              status: "pending_payment",
              reservationExpiresAt: { $lte: now },
              expiring: { $ne: true },
            },
            { $set: { expiring: true, expiringAt: now } },
            { new: true },
          )
          .lean();

        if (!claimed) continue; // มีคนอื่นทำไปแล้ว หรือสถานะเปลี่ยน

        try {
          // 1) ทำใน TX และใช้ markMasterExpired (อัปเดต master + store + release stock)
          const updated = await runTxnWithRetry(this.conn, async (session) => {
            // เปลี่ยนให้ markMasterExpired คืน boolean ถ้าสะดวก (ดูหมายเหตุด้านล่าง)
            const before = await this.masterOrderModel
              .findOne({ _id: it._id }, { status: 1 }, { session })
              .lean();

            await this.orders.markMasterExpired(
              masterOrderId,
              { reason: "payment_timeout", expiredAt: now },
              session,
            );

            const after = await this.masterOrderModel
              .findOne({ _id: it._id }, { status: 1 }, { session })
              .lean();

            return (
              before?.status === "pending_payment" &&
              after?.status === "expired"
            );
          });

          // 2) นอก TX: ยกเลิก PI (ถ้ามี) + publish เฉพาะเมื่อเปลี่ยนสถานะจริง
          if (updated) {
            if (
              it.paymentIntentId &&
              (!it.paymentProvider ||
                it.paymentProvider.toLowerCase() === "stripe")
            ) {
              try {
                await this.stripe.paymentIntents.cancel(it.paymentIntentId, {
                  cancellation_reason: "abandoned",
                });
              } catch {
                /* ignore */
              }
            }

            // publish to exchange payments.event
            await this.mq.publishTopic(
              EXCHANGES.PAYMENTS_EVENTS,
              "payments.canceled",
              {
                masterOrderId,
                paymentIntentId: it.paymentIntentId,
                reason: "payment_timeout",
                at: new Date().toISOString(),
              },
              {
                messageId: `master:${masterOrderId}:timeout:${Date.now()}`,
                persistent: true,
              },
            );

            const evt = {
              eventId: `order:${masterOrderId}:payment_expired`,
              buyerId: String(it.buyerId),
              masterOrderId: masterOrderId,
              orderNumber: masterOrderId,
              total: it.pricing.grandTotal,
              occurredAt: new Date().toISOString(),
              currency: it.currency || "THB",
              paymentMethod: "card",
              expiresAt: it.reservationExpiresAt, // หรือใช้ reservationExpiresAt เดิม
            };
            // publish to exchange orders.events
            await this.mq.publishTopic(
              EXCHANGES.ORDERS_EVENTS,
              "orders.payment_expired",
              evt,
              { messageId: evt.eventId, persistent: true },
            );

            processed++;
          }
        } catch (err) {
          this.logger.error(
            `expire ${masterOrderId} failed: ${(err as Error).message}`,
          );
          // ปลด claim เพื่อให้รอบถัดไปหยิบได้
          await this.masterOrderModel
            .updateOne(
              { _id: it._id, expiring: true },
              { $unset: { expiring: 1, expiringAt: 1 } },
            )
            .catch(() => {});
        }
      }
    }

    this.logger.log(`expired masters processed: ${processed}`);
  }
}
