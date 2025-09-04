// src/webhooks/schemas/webhook-event.schema.ts
import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";

export type CarrierWebhookEventDocument = CarrierWebhookEvent & Document;

@Schema({ timestamps: true })
export class CarrierWebhookEvent {
  @Prop({ required: true }) source!: string; // "carrier"
  @Prop({ required: true }) carrier!: string; // "TH-EMS"
  @Prop({ required: true, unique: true }) eventId!: string;
  @Prop() idemKey?: string;
  @Prop({ type: Object }) payload?: Record<string, any>;
  @Prop() receivedAt?: Date;
}
export const CarrierWebhookEventSchema =
  SchemaFactory.createForClass(CarrierWebhookEvent);
