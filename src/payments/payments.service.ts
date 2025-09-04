// src/payments/payments.service.ts
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  GoneException,
} from "@nestjs/common";
import Stripe from "stripe";
import { CreateIntentArgs, CreateIntentResult } from "./payment.types";
import { STRIPE_CLIENT } from "./constants";
import { FilterQuery, Model, Types } from "mongoose";
import { InjectModel } from "@nestjs/mongoose";
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
  constructor(
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,

    // ⬇️ เปลี่ยนมาใช้ MasterOrder
    @InjectModel(MasterOrder.name)
    private readonly masterOrderModel: Model<MasterOrderDocument>,
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
}
