// src/notification/schemas/notification.schema.ts
import { Schema, SchemaFactory, Prop } from "@nestjs/mongoose";
import { HydratedDocument, Types } from "mongoose";

export type NotificationDocument = HydratedDocument<Notification>;

@Schema({
  versionKey: false,
  timestamps: { createdAt: true, updatedAt: false },
})
export class Notification {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({
    required: true,
    enum: ["UNREAD", "READ", "ARCHIVED"],
    default: "UNREAD",
    index: true,
  })
  status!: "UNREAD" | "READ" | "ARCHIVED";

  @Prop({ required: true }) // e.g. 'ORDER_CREATED' | 'ORDER_PAID' ...
  type!: string;

  @Prop({ required: true })
  title!: string;

  @Prop({ required: true })
  body!: string;

  @Prop({ type: Object, default: {} })
  data!: Record<string, unknown>; // { masterOrderId, storeOrderId?, trackingNo? }

  // ---- Idempotency / Audit ----
  @Prop({ required: true }) // unique ต่อผู้ใช้
  dedupeKey!: string; // e.g. `orders.created:${masterOrderId}`

  @Prop()
  eventId?: string; // จาก MQ (messageId/eventId)

  @Prop()
  routingKey?: string; // 'orders.created' ฯลฯ

  @Prop()
  occurredAt?: Date; // จาก payload.occurredAt
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

// Unique กัน insert ซ้ำ (ต่อ userId + dedupeKey)
NotificationSchema.index({ userId: 1, dedupeKey: 1 }, { unique: true });

// ฟีดเรียงล่าสุดก่อน
NotificationSchema.index({ userId: 1, status: 1, createdAt: -1 });
