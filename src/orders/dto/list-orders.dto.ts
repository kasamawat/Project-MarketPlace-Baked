import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsInt, IsOptional, Min } from "class-validator";

export class ListOrdersDto {
  // ✅ ใหม่: ฟิลเตอร์ตามแท็บใหม่
  @ApiPropertyOptional({
    enum: ["pending_payment", "paid", "expired", "canceled"],
  })
  @IsOptional()
  @IsIn(["pending_payment", "paid", "expired", "canceled"])
  buyerStatus?: "pending_payment" | "paid" | "expired" | "canceled";

  @ApiPropertyOptional({ enum: ["PENDING", "PACKED", "SHIPPED", "DELIVERED"] })
  @IsOptional()
  @IsIn(["PENDING", "PACKED", "SHIPPED", "DELIVERED"])
  storeStatus?: "PENDING" | "PACKED" | "SHIPPED" | "DELIVERED";

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number = 10;
}
