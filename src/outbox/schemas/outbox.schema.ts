// outbox/outbox.schema.ts
import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";

export type OutboxDocument = HydratedDocument<Outbox>;

@Schema({
  collection: "outbox",
  timestamps: { createdAt: true, updatedAt: true },
})
export class Outbox {
  @Prop({ required: true }) topic!: string; // เช่น 'search.index.product'
  @Prop({ required: true, type: Object }) payload!: any; // JSON พร้อม mapForIndex แล้ว
  @Prop({
    required: true,
    default: "PENDING",
    enum: ["PENDING", "SENT", "FAILED"],
  })
  status!: "PENDING" | "SENT" | "FAILED";
  @Prop({ default: 0 }) attempts!: number;
  @Prop({ default: null }) nextAttemptAt!: Date; // ใช้ทำ backoff
  @Prop({ default: null }) errorMsg!: string;
}

export const OutboxSchema = SchemaFactory.createForClass(Outbox);
OutboxSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });
