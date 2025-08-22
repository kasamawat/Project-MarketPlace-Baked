// src/payments/schemas/webhook-event.schema.ts
import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type WebhookEventDocument = WebhookEvent & Document;

@Schema({ timestamps: true })
export class WebhookEvent {
  @Prop({ required: true, unique: true, index: true })
  eventId!: string; // Stripe event.id

  @Prop({ required: true, default: "stripe" })
  provider!: "stripe";

  @Prop({ required: true })
  type!: string; // event.type

  @Prop()
  orderId?: string; // ดึงจาก metadata ถ้ามี

  @Prop({ type: Date, default: () => new Date() })
  handledAt!: Date; // เวลา mark handled

  @Prop()
  receivedAt?: number; // event.created (epoch sec -> เก็บเป็น ms ก็ได้)
}

export const WebhookEventSchema = SchemaFactory.createForClass(WebhookEvent);

// (ทางเลือก) ลบทิ้งอัตโนมัติหลัง 30 วัน
// WebhookEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });
