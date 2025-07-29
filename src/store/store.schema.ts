import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import mongoose from "mongoose";

@Schema()
export class Store {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, unique: true })
  slug: string;

  @Prop()
  description?: string;

  @Prop()
  logoUrl?: string;

  @Prop()
  coverUrl?: string;

  @Prop()
  phone?: string;

  @Prop()
  bankName?: string;

  @Prop()
  bankAccountNumber?: string;

  @Prop()
  bankAccountName?: string;

  @Prop()
  productCategory?: string;

  @Prop()
  returnPolicy?: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: "User" })
  ownerId: string;

  @Prop({ default: "pending" })
  status: "pending" | "approved" | "rejected";

  @Prop({ default: () => new Date() })
  createdAt: Date;
}

export const StoreSchema = SchemaFactory.createForClass(Store);
