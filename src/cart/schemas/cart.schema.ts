import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Types } from "mongoose";

export type CartDocument = Cart & Document;

// cart.schema.ts
@Schema({ timestamps: true })
export class Cart {
  @Prop() cartKey!: string; // ใช้กับ guest (unique)
  @Prop({ type: Types.ObjectId }) userId?: Types.ObjectId; // ถ้าล็อกอิน
  @Prop({ enum: ["open", "merged", "converted", "abandoned"], default: "open" })
  status!: string;

  // summary (denormalized เพื่ออ่านเร็ว)
  @Prop({ default: 0 }) itemsCount!: number;
  @Prop({ default: 0 }) itemsTotal!: number; // รวม subtotal ทั้งหมด
  @Prop() currency?: string; // "THB"

  @Prop() expiresAt?: Date; // สำหรับ guest cart + TTL index
}
export const CartSchema = SchemaFactory.createForClass(Cart);
CartSchema.index({ cartKey: 1 }, { unique: true, sparse: true });
CartSchema.index({ userId: 1, status: 1 });
CartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
