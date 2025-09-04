// src/orders/dto/place-order.dto.ts
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";
import { PaymentMethodKind } from "src/payments/payment.types";
import { AddressInfo } from "../types/store-order-detail.types";

export class PlaceOrderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  note?: string;

  @ApiProperty({ enum: ["card", "promptpay", "cod"] })
  @IsString()
  @IsIn(["card", "promptpay", "cod"])
  paymentMethod!: PaymentMethodKind;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  shippingAddress?: AddressInfo; // เก็บ raw ง่าย ๆ ก่อน (firstName, phone, line1, ...)

  // (ไม่รับรายการสินค้า—ดึงจาก cart ฝั่ง BE เพื่อความปลอดภัย)
}

export type CheckoutResponseDtoNew = {
  masterOrderId: string;
  storeOrders: Array<{ storeOrderId: string; storeId: string }>;
  amount: number;
  currency: string;
  clientSecret?: string;
  expiresAt?: Date;
};
