// src/payments/payments.service.ts
import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  GoneException,
} from "@nestjs/common";
import Stripe from "stripe";
import { CreateIntentArgs, CreateIntentResult } from "./payment.types";
import { STRIPE_CLIENT } from "./constants";
import { OrdersService } from "src/orders/orders.service";
import { InventoryService } from "src/inventory/inventory.service";
import { ClientSession, Connection, FilterQuery, Model, Types } from "mongoose";
import { InjectConnection, InjectModel } from "@nestjs/mongoose";
import { EXCHANGES } from "src/messaging/mq.topology";
import { PendingEvent } from "./types/payments.types";
import {
  WebhookEvent,
  WebhookEventDocument,
} from "./schemas/webhook-event.schema";
import { MQ_PUBLISHER } from "src/messaging/mq.tokens";
import {
  PaymentEvent,
  PaymentEventDocument,
} from "./schemas/payment-event.schema";
import { MqPublisher } from "src/messaging/mq.types";

// ====== ใช้ MasterOrder/StoreOrder แทน Order เดิม ======
import {
  MasterOrder,
  MasterOrderDocument,
} from "src/orders/schemas/master-order.schema";

// ถ้าคุณมี type สำหรับ method/provider:
type PaymentMethod = "card" | "promptpay" | "cod";
// type PaymentProvider = "stripe" | "omise" | "xendit" | "promptpay";

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,

    // ⬇️ เปลี่ยนมาใช้ MasterOrder
    @InjectModel(MasterOrder.name)
    private readonly masterOrderModel: Model<MasterOrderDocument>,

    @Inject(forwardRef(() => OrdersService))
    private readonly orders: OrdersService,

    private readonly inventory: InventoryService,

    @Inject(MQ_PUBLISHER) private readonly mq: MqPublisher,

    @InjectModel(PaymentEvent.name)
    private readonly paymentEventModel: Model<PaymentEventDocument>,

    @InjectModel(WebhookEvent.name)
    private readonly webhookEventModel: Model<WebhookEventDocument>,

    @InjectConnection() private readonly connection: Connection,
  ) {}

  // =============== Create Intent (Stripe) ===============
  async createGeneralIntent(
    args: CreateIntentArgs,
  ): Promise<CreateIntentResult> {
    const amountSatang = Math.round(args.amount * 100);
    const intent = await this.stripe.paymentIntents.create(
      {
        amount: amountSatang,
        currency: "thb",
        automatic_payment_methods: { enabled: true },
        metadata: { masterOrderId: args.masterOrderId }, // <- masterOrderId
        receipt_email: args.customerEmail,
      },
      { idempotencyKey: `master:${args.masterOrderId}:auto` },
    );
    if (!intent.client_secret)
      throw new Error("Stripe did not return client_secret");
    return {
      clientSecret: intent.client_secret,
      intentId: intent.id,
      provider: "stripe",
    };
  }

  async createPromptPayIntent(
    args: CreateIntentArgs,
  ): Promise<CreateIntentResult> {
    const amountSatang = Math.round(args.amount * 100);
    const intent = await this.stripe.paymentIntents.create(
      {
        amount: amountSatang,
        currency: "thb",
        payment_method_types: ["promptpay"],
        capture_method: "automatic",
        metadata: { masterOrderId: args.masterOrderId }, // <- masterOrderId
        receipt_email: args.customerEmail,
      },
      { idempotencyKey: `master:${args.masterOrderId}:promptpay` },
    );
    if (!intent.client_secret)
      throw new Error("Stripe did not return client_secret");
    return {
      clientSecret: intent.client_secret,
      intentId: intent.id,
      provider: "stripe",
    };
  }

  /** ดึง client_secret ของ PaymentIntent เดิม (ถ้ามี) */
  async getClientSecret(intentId: string): Promise<string | null> {
    const pi = await this.stripe.paymentIntents.retrieve(intentId);
    return pi?.client_secret ?? null;
  }

  /** public createIntent: เลือกตาม method */
  async createIntent(args: CreateIntentArgs): Promise<CreateIntentResult> {
    if (args.method === "promptpay") return this.createPromptPayIntent(args);
    return this.createGeneralIntent(args); // card/automatic
  }

  // =============== Ensure Intent (Master) ===============
  async ensureIntent(args: {
    masterOrderId: string;
    method: Exclude<PaymentMethod, "cod">; // online only
    customerEmail?: string;
  }): Promise<CreateIntentResult> {
    const _id = new Types.ObjectId(args.masterOrderId);
    const master = await this.masterOrderModel
      .findById(_id)
      .select(
        "status paymentProvider payment paymentIntentId pricing currency reservationExpiresAt buyerId",
      )
      .lean();

    if (!master) throw new NotFoundException("Order not found");
    if (master.status === "paid")
      throw new ConflictException("Order already paid");
    if (master.status === "canceled")
      throw new BadRequestException("Order was canceled");

    if (master.status === "expired") {
      // ยกเลิก intent เก่าถ้ามี
      if (master.paymentIntentId) {
        try {
          await this.stripe.paymentIntents.cancel(master.paymentIntentId, {
            cancellation_reason: "abandoned",
          });
        } catch {
          /* ignore */
        }
      }
      throw new GoneException("Order expired. Please restart checkout.");
    }

    if (master.status !== "pending_payment") {
      throw new BadRequestException("Order is not awaiting payment");
    }

    const amount = master?.pricing?.grandTotal ?? 0;

    // Reuse intent ถ้าใช้ได้
    const existing = master.paymentIntentId || master.payment?.intentId;
    if (existing) {
      const pi = await this.stripe.paymentIntents.retrieve(existing);
      if (
        args.method === "promptpay" &&
        !(pi.payment_method_types ?? []).includes("promptpay")
      ) {
        // ยกเลิกแล้วสร้างใหม่
        try {
          await this.stripe.paymentIntents.cancel(pi.id, {
            cancellation_reason: "requested_by_customer",
          });
          // eslint-disable-next-line no-empty
        } catch {}
      } else if (pi.client_secret) {
        return {
          intentId: pi.id,
          clientSecret: pi.client_secret,
          provider: "stripe",
        };
      }
    }

    // สร้างใหม่
    const cr = await this.createIntent({
      masterOrderId: String(_id), // master id
      amount,
      method: args.method,
      customerEmail: args.customerEmail,
    });

    // บันทึกลง Master (idempotent)
    await this.masterOrderModel.updateOne(
      { _id, status: "pending_payment" } as FilterQuery<MasterOrderDocument>,
      {
        $set: {
          paymentProvider: cr.provider ?? "stripe",
          paymentIntentId: cr.intentId,
          "payment.provider": cr.provider ?? "stripe",
          "payment.method": args.method,
          "payment.intentId": cr.intentId,
          "payment.status": "processing",
          "payment.amount": amount,
          "payment.currency": (master.currency ?? "THB").toUpperCase(),
        },
        $push: {
          timeline: {
            type: "payment.processing",
            at: new Date(),
            by: "system",
            payload: { intentId: cr.intentId, method: args.method },
          },
        },
      },
    );

    return cr;
  }

  // ============================== Webhook ==============================
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
      await this.webhookEventModel
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

  // async testEvent() {
  //   await this.mq.publishTopic(
  //     EXCHANGES.PAYMENTS_EVENTS,
  //     "payments.test",
  //     { hello: "world" },
  //     { messageId: "test-1" },
  //   );
  // }
}
