// dto/store-orders.dto.ts
import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Min } from "class-validator";

export class StoreOrdersDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @ApiPropertyOptional({
    description: "Payment status on StoreOrder",
    enum: ["all", "paid", "pending_payment", "canceled", "expired"],
    default: "all",
  })
  @IsOptional()
  @IsIn(["all", "paid", "pending_payment", "canceled", "expired"])
  buyerStatus?: "all" | "paid" | "pending_payment" | "canceled" | "expired";

  @IsOptional()
  @IsIn(["all", "PENDING", "SHIPPED", "DELIVERED"])
  storeStatus?: "PENDING,PACKED" | "SHIPPED" | "DELIVERED" | "all";

  @ApiPropertyOptional({
    description:
      "Fulfill statuses (item level). Accepts comma, repeated params or UNFULFILLED.",
    examples: ["PENDING,PACKED", "SHIPPED", "UNFULFILLED", "all"],
  })
  @IsOptional()
  @IsString({ message: "fulfillStatus must be string when provided" })
  fulfillStatus?: string; // รองรับหลายรูปแบบ (จะ parse ใน service)
}
