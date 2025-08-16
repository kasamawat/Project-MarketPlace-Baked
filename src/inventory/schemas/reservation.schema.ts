// reservation.schema.ts
import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import mongoose, { Document, Types } from "mongoose";

export type ReservationDocument = Reservation & Document;

@Schema({ timestamps: true })
export class Reservation {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: "Sku", required: true })
  skuId!: Types.ObjectId;
  @Prop({ required: true }) qty!: number;
  @Prop({ required: true }) expiresAt!: Date;

  @Prop() cartId?: string;
  @Prop() userId?: string;
}
export const ReservationSchema = SchemaFactory.createForClass(Reservation);
// TTL index
ReservationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
