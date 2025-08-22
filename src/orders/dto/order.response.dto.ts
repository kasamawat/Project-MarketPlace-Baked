// src/orders/dto/order.response.dto.ts
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Expose, Transform, Type } from "class-transformer";

export class OrderItemResponseDto {
  @ApiProperty()
  @Expose()
  @Transform(({ value }) => String(value))
  productId!: string;
  @ApiProperty()
  @Expose()
  @Transform(({ value }) => String(value))
  skuId!: string;
  @ApiProperty()
  @Expose()
  @Transform(({ value }) => String(value))
  storeId!: string;

  @ApiProperty() @Expose() productName!: string;
  @ApiPropertyOptional() @Expose() productImage?: string;

  @ApiProperty({ type: Object }) @Expose() attributes!: Record<string, string>;

  @ApiProperty() @Expose() unitPrice!: number;
  @ApiProperty() @Expose() quantity!: number;
  @ApiProperty() @Expose() subtotal!: number;
}

export class PaymentInfoResponseDto {
  @ApiPropertyOptional() @Expose() provider?: string; // 'stripe' | 'promptpay' | ...
  @ApiPropertyOptional() @Expose() intentId?: string;
  @ApiPropertyOptional() @Expose() chargeId?: string;
  @ApiPropertyOptional() @Expose() status?:
    | "requires_action"
    | "processing"
    | "succeeded"
    | "failed"
    | "canceled";
  @ApiPropertyOptional() @Expose() amount?: number;
  @ApiPropertyOptional() @Expose() currency?: string;
}

export class PricingResponseDto {
  @ApiProperty() @Expose() itemsTotal!: number;
  @ApiProperty() @Expose() shippingFee!: number;
  @ApiProperty() @Expose() discountTotal!: number;
  @ApiProperty() @Expose() taxTotal!: number;
  @ApiProperty() @Expose() grandTotal!: number;
}

export class OrderDetailResponseDto {
  @ApiProperty()
  @Expose()
  @Transform(({ value }) => String(value))
  _id!: string;

  @ApiPropertyOptional()
  @Expose()
  @Transform(({ value }) => (value ? String(value) : undefined))
  userId?: string;

  @ApiProperty()
  @Expose()
  @Transform(({ value }) => String(value))
  cartId!: string;

  @ApiProperty() @Expose() currency!: string;

  @ApiProperty({ type: [OrderItemResponseDto] })
  @Expose()
  @Type(() => OrderItemResponseDto)
  items!: OrderItemResponseDto[];

  @ApiProperty() @Expose() itemsCount!: number;
  @ApiProperty() @Expose() itemsTotal!: number;

  @ApiProperty({ enum: ["pending_payment", "paid", "canceled", "expired"] })
  @Expose()
  status!: "pending_payment" | "paid" | "canceled" | "expired";

  @ApiPropertyOptional({ type: PaymentInfoResponseDto })
  @Expose()
  @Type(() => PaymentInfoResponseDto)
  payment?: PaymentInfoResponseDto;

  @ApiPropertyOptional()
  @Expose()
  reservationExpiresAt?: string; // ISO string

  @ApiProperty()
  @Expose()
  @Transform(({ value }) => new Date(value).toISOString())
  createdAt!: string;

  @ApiProperty()
  @Expose()
  @Transform(({ value }) => new Date(value).toISOString())
  updatedAt!: string;
}

// ใช้ตอน place order เสร็จ (สำหรับเริ่มจ่ายเงินที่ FE)
export class PlaceOrderResponseDto {
  @ApiProperty() orderId!: string;
  @ApiProperty() status!: "pending_payment" | "paid" | "canceled" | "expired";
  @ApiProperty() clientSecret?: string; // กรณี Stripe Payment Element
  @ApiProperty() paymentLinkUrl?: string; // กรณีไป Hosted Page
}
