// src/orders/dto/order-summary.response.dto.ts
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Expose, Transform } from "class-transformer";

export class OrderSummaryResponseDto {
  @ApiProperty()
  @Expose()
  @Transform(({ value }) => String(value))
  _id!: string;
  @ApiPropertyOptional()
  @Expose()
  @Transform(({ value }) => (value ? String(value) : undefined))
  userId?: string;
  @ApiProperty() @Expose() itemsCount!: number;
  @ApiProperty() @Expose() itemsTotal!: number;
  @ApiProperty() @Expose() currency!: string;
  @ApiProperty() @Expose() status!:
    | "pending_payment"
    | "paid"
    | "canceled"
    | "expired";
  @ApiProperty()
  @Expose()
  @Transform(({ value }) => new Date(value).toISOString())
  createdAt!: string;
  @ApiProperty()
  @Expose()
  @Transform(({ value }) => new Date(value).toISOString())
  updatedAt!: string;
}
