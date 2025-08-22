import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import Stripe from "stripe";
import { CreateIntentArgs, CreateIntentResult } from "./payment.types";
import { STRIPE_CLIENT } from "./constants";
import { OrdersService } from "src/orders/orders.service";
import { InventoryService } from "src/inventory/inventory.service";
import { ClientSession, Connection, Model, Types } from "mongoose";
import { InjectConnection, InjectModel } from "@nestjs/mongoose";
// import { MqPublisher } from "src/messaging/mq.types";
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
import { Order, OrderDocument } from "src/orders/schemas/order.schema";

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @Inject(forwardRef(() => OrdersService)) // ← ใช้เฉพาะเมื่อมีวงจรจริง
    private readonly orders: OrdersService,
    private readonly inventory: InventoryService, // Assuming you have an InventoryService
    @Inject(MQ_PUBLISHER) private readonly mq: MqPublisher, // Assuming you have a message queue publisher
    @InjectModel(PaymentEvent.name)
    private readonly paymentEventModel: Model<PaymentEventDocument>, // << ใช้ PaymentEvent.name
    @InjectModel(WebhookEvent.name)
    private readonly webhookEventModel: Model<WebhookEventDocument>,
    @InjectConnection()
    private readonly connection: Connection,
  ) {}

  // สร้าง intent แบบ “การ์ด/วิธีจ่ายทั่วไป” (ใช้ Payment Element ฝั่ง FE)
  async createGeneralIntent(
    args: CreateIntentArgs,
  ): Promise<CreateIntentResult> {
    const amountSatang = Math.round(args.amount * 100);
    const intent = await this.stripe.paymentIntents.create(
      {
        amount: amountSatang,
        currency: "thb",
        automatic_payment_methods: { enabled: true },
        metadata: { orderId: args.orderId },
        receipt_email: args.customerEmail,
      },
      { idempotencyKey: `order:${args.orderId}` },
    );

    const cs = intent.client_secret;
    if (!cs) {
      throw new Error("Stripe did not return client_secret");
    }

    return { clientSecret: cs, intentId: intent.id };
  }

  // สร้าง intent สำหรับ PromptPay
  async createPromptPayIntent(
    args: CreateIntentArgs,
  ): Promise<CreateIntentResult> {
    const amountSatang = Math.round(args.amount * 100);
    const intent = await this.stripe.paymentIntents.create(
      {
        amount: amountSatang,
        currency: "thb",
        payment_method_types: ["promptpay"],
        capture_method: "automatic", // ปกติ auto capture
        metadata: { orderId: args.orderId },
        receipt_email: args.customerEmail,
      },
      { idempotencyKey: `order:${args.orderId}:promptpay` },
    );

    const cs = intent.client_secret;
    if (!cs) {
      throw new Error("Stripe did not return client_secret");
    }

    return { clientSecret: cs, intentId: intent.id };
  }

  async createIntent(args: CreateIntentArgs): Promise<CreateIntentResult> {
    if (args.method === "promptpay") {
      return this.createPromptPayIntent(args);
    } else {
      return this.createGeneralIntent(args);
    }
  }

  async ensureIntent(args: {
    orderId: string;
    method: "automatic" | "promptpay";
  }) {
    const orderIdObj = new Types.ObjectId(args.orderId);
    const order = await this.orderModel.findById(orderIdObj);
    if (!order) throw new NotFoundException("Order not found");
    if (!["pending_payment", "paying", "processing"].includes(order.status))
      throw new BadRequestException("Order is not awaiting payment");

    // ถ้ามี intentId แล้ว → ลองดึงจาก Stripe
    if (order.paymentIntentId) {
      const pi = await this.stripe.paymentIntents.retrieve(
        order.paymentIntentId,
      );
      // ถ้ารูปแบบไม่ตรง (เช่น ต้อง promptpay เท่านั้น) อาจยกเลิกแล้วสร้างใหม่
      if (
        args.method === "promptpay" &&
        !(pi.payment_method_types ?? []).includes("promptpay")
      ) {
        await this.stripe.paymentIntents.cancel(pi.id, {
          cancellation_reason: "abandoned",
        });
      } else if (pi.client_secret) {
        return { intentId: pi.id, clientSecret: pi.client_secret };
      }
    }

    // สร้างใหม่
    const amountSatang = Math.round(order.itemsTotal * 100);
    // {
    //     amount: amountSatang,
    //     currency: "thb",
    //     automatic_payment_methods: { enabled: true },
    //     metadata: { orderId: args.orderId },
    //     receipt_email: args.customerEmail,
    //   },
    //   { idempotencyKey: `order:${args.orderId}` },

    let createParams: Stripe.PaymentIntentCreateParams;

    if (args.method === "promptpay") {
      createParams = {
        amount: amountSatang,
        currency: "thb",
        // ❌ อย่าใส่ as const
        payment_method_types: ["promptpay"], // <- string[]
        metadata: { orderId: args.orderId },
      };
    } else {
      createParams = {
        amount: amountSatang,
        currency: "thb",
        automatic_payment_methods: { enabled: true },
        metadata: { orderId: args.orderId },
      };
    }

    const piNew = await this.stripe.paymentIntents.create(createParams, {
      idempotencyKey: `order:${args.orderId}:ensure:${args.method}`,
    });

    // บันทึก intentId ลง order ถ้ายังไม่มี/เพิ่งสร้างใหม่
    await this.orderModel
      .updateOne(
        {
          orderIdObj,
          // เขียนเฉพาะสถานะที่ยังเปิดอยู่
          status: { $in: ["pending_payment", "paying", "processing"] },
          // idempotent: อัปเดตก็ต่อเมื่อไม่มี/ต่างจากเดิม
          $or: [
            { paymentIntentId: { $exists: false } },
            { paymentIntentId: { $ne: piNew.id } },
          ],
        },
        {
          $set: {
            paymentProvider: "stripe",
            paymentIntentId: piNew.id,
            updatedAt: new Date(),
          },
        },
      )
      .exec();

    if (!piNew.client_secret)
      throw new Error("Stripe did not return client_secret");
    return { intentId: piNew.id, clientSecret: piNew.client_secret };
  }

  // ============================== Webhook ==============================
  // ตรวจสอบและแปลง webhook event จาก Stripe
  verifyAndParseWebhook(rawBody: Buffer, signature: string, secret: string) {
    try {
      return this.stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Invalid signature";
      this.logger.warn(`Stripe verify failed: ${msg}`);
      throw new BadRequestException("Invalid Stripe signature");
    }
  }

  /**
   * ป้องกันประมวลผลซ้ำ (idempotent) ด้วย event.id จาก Stripe
   */
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
  }

  /**
   * ดึง orderId อย่างปลอดภัยจาก metadata
   */
  private getOrderIdFromEvent(event: Stripe.Event): string | undefined {
    // เราสนใจเฉพาะ payment_intent.*
    if (!event.type.startsWith("payment_intent.")) return undefined;
    const obj = event.data.object as Stripe.PaymentIntent;
    return obj?.metadata?.orderId || obj?.metadata?.order_id; // เผื่อเคสสะกดต่างกัน
  }

  /** ทำเครื่องหมายว่า “จัดการแล้ว” (ใช้ใน transaction เดียวกับธุรกรรมหลัก) */
  async markHandled(
    event: Stripe.Event,
    session?: ClientSession,
  ): Promise<void> {
    const orderId = this.getOrderIdFromEvent(event);
    const payload = {
      eventId: event.id,
      provider: "stripe" as const,
      type: event.type,
      orderId,
      handledAt: new Date(),
      receivedAt:
        typeof event.created === "number" ? event.created * 1000 : undefined,
    };

    try {
      // ใช้ upsert + unique index ที่ eventId เพื่อกันซ้ำเชิง race condition
      await this.webhookEventModel
        .updateOne(
          { eventId: event.id },
          { $setOnInsert: payload },
          { upsert: true, session },
        )
        .exec();
    } catch (err: any) {
      // ถ้าชน unique (E11000) แสดงว่ามีใคร insert ไปแล้ว → ข้ามได้
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (err?.code === 11000) return;
      throw err;
    }
  }

  /**
   * จัดการเหตุการณ์จาก Stripe
   */
  async handleEvent(event: Stripe.Event): Promise<void> {
    // 1) กันซ้ำ
    if (await this.alreadyHandled(event)) {
      this.logger.debug(`Skip duplicate event ${event.id} (${event.type})`);
      return;
    }

    // 2) สนใจเฉพาะ PI events
    if (!event.type.startsWith("payment_intent.")) {
      this.logger.debug(`Ignore non-PI event: ${event.type}`);
      return;
    }

    const pi = event.data.object as Stripe.PaymentIntent;

    const orderId = this.getOrderIdFromEvent(event);
    if (!orderId) {
      this.logger.warn("missing orderId");
      return;
    }

    if (!Types.ObjectId.isValid(orderId)) {
      this.logger.error(`Invalid orderId for Mongo: ${orderId}`);
      return; // กัน TX พัง แล้วค่อยกลับไปแก้ที่แหล่งกำเนิด
    }

    const pendingEvents: PendingEvent[] = [];

    // console.log(event);
    // Open Mongo transaction / session
    // ถ้ามี replica set -> ใช้ transaction; ถ้าไม่มี ให้ตัดส่วน transaction แล้ว call service แบบอะตอมมิกแทน
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        switch (event.type) {
          case "payment_intent.processing": {
            await this.orders.markPaying(
              orderId,
              {
                paymentIntentId: pi.id,
                amount: (pi.amount ?? 0) / 100,
                currency: pi.currency ?? "thb",
              },
              session,
            );

            // Publish MQ
            pendingEvents.push({
              routingKey: "payments.processing",
              payload: {
                orderId,
                paymentIntentId: pi.id,
                at: new Date().toISOString(),
              },
              messageId: `stripe:${event.id}:processing`,
            });
            break;
          }

          case "payment_intent.succeeded": {
            await this.inventory.commitReservationByOrder(
              orderId,
              { reason: "stripe_succeeded", referenceId: pi.id },
              session,
            );

            const chargeId =
              typeof pi.latest_charge === "string"
                ? pi.latest_charge
                : pi.latest_charge?.id;

            await this.orders.markPaid(
              orderId,
              {
                paymentIntentId: pi.id,
                chargeId,
                paidAt: new Date(),
                // ใช้ amount_received ถ้ามี
                amount:
                  typeof pi.amount_received === "number"
                    ? pi.amount_received / 100
                    : (pi.amount ?? 0) / 100,
                currency: pi.currency ?? "thb",
              },
              session,
            );

            // Publish MQ
            pendingEvents.push({
              routingKey: "payments.succeeded",
              payload: {
                orderId,
                paymentIntentId: pi.id,
                chargeId,
                at: new Date().toISOString(),
              },
              messageId: `stripe:${event.id}:succeeded`,
            });
            break;
          }

          case "payment_intent.payment_failed":
          case "payment_intent.canceled": {
            await this.inventory.releaseReservationByOrder(
              orderId,
              { reason: event.type, referenceId: pi.id },
              session,
            );

            await this.orders.markFailed(
              orderId,
              {
                paymentIntentId: pi.id,
                failureReason:
                  pi.last_payment_error?.message ||
                  (event.type === "payment_intent.canceled"
                    ? "canceled"
                    : "payment_failed"),
              },
              session,
            );

            // Publish MQ
            pendingEvents.push({
              routingKey: "payments.failed",
              payload: {
                orderId,
                paymentIntentId: pi.id,
                error: pi.last_payment_error?.message,
                at: new Date().toISOString(),
              },
              messageId: `stripe:${event.id}:failed`,
            });
            break;
          }

          // ถ้าใช้ manual capture:
          // case 'payment_intent.amount_capturable_updated': { ... } break;

          default:
            this.logger.debug(`Unhandled PI event: ${event.type}`);
            break;
        }

        // บันทึกว่า handled แล้ว (idempotency record) **ข้างใน transaction**
        await this.markHandled(event, session);
      });
    } catch (err) {
      console.log("Error: ", (err as Error)?.message);
    } finally {
      await session.endSession();
    }

    // 4) Publish หลัง commit สำเร็จ
    for (const ev of pendingEvents) {
      await this.mq.publishTopic(
        EXCHANGES.PAYMENTS_EVENTS,
        ev.routingKey,
        ev.payload,
        { messageId: ev.messageId, persistent: true },
      );
    }
  }

  async testEvent() {
    await this.mq.publishTopic(
      EXCHANGES.PAYMENTS_EVENTS,
      "payments.test",
      { hello: "world" },
      { messageId: "test-1" },
    );
  }
}
