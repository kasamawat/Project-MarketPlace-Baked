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

  @Cron(CronExpression.EVERY_10_SECONDS) // ปรับเป็น EVERY_MINUTE ในโปรดักชัน
  async sweep() {
    const now = new Date();
    let processed = 0;
    let picked = 0;

    // ดึงเป็นก้อน ๆ จนกว่าจะหมดในรอบนี้
    do {
      const list = await this.masterOrderModel
        .find({
          status: "pending_payment",
          reservationExpiresAt: { $lte: now },
        })
        .select("_id paymentIntentId paymentProvider") // ใช้ provider ตัดสินใจยกเลิก PI
        .sort({ reservationExpiresAt: 1 })
        .limit(BATCH)
        .lean<
          {
            _id: Types.ObjectId;
            paymentIntentId?: string;
            paymentProvider?: string;
          }[]
        >()
        .exec();

      picked = list.length;
      if (!picked) break;

      for (const it of list) {
        const masterOrderId = String(it._id);
        const session = await this.conn.startSession();
        try {
          await session.withTransaction(async () => {
            // 1) คืน stock ที่จองไว้ทั้งหมดของ master (idempotent)
            await this.inventory.releaseByMaster(masterOrderId, session);

            // 2) mark expired (เฉพาะยัง pending_payment; ถ้าแข่งกันจะ no-op)
            await this.orders.markMasterExpired(
              masterOrderId,
              { reason: "payment_timeout" },
              session,
            );
          });

          // 3) ยกเลิก PaymentIntent (นอกรอบ TX; เงียบ ๆ ได้)
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
              /* ignore cancel errors */
            }
          }

          // 4) แจ้ง MQ → ใช้ canceled พร้อม reason=payment_timeout
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

          processed++;
        } catch (err) {
          this.logger.error(
            `expire ${masterOrderId} failed: ${(err as Error).message}`,
          );
          // ไม่ต้องทำอะไรเพิ่ม: ทั้ง release & markMasterExpired เป็น idempotent และเราใช้ TX แล้ว
        } finally {
          await session.endSession();
        }
      }
    } while (picked === BATCH);

    this.logger.log(`expired masters processed: ${processed}`);
  }
}
