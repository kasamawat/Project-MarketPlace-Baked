import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsInt, IsOptional, Min } from "class-validator";

export class ListOrdersDto {
  @ApiPropertyOptional({
    enum: [
      "all",
      "pending_payment",
      "paying",
      "processing",
      "paid",
      "expired",
      "canceled",
    ],
  })
  @IsOptional()
  @IsIn([
    "all",
    "pending_payment",
    "paying",
    "processing",
    "paid",
    "expired",
    "canceled",
  ])
  status?:
    | "all"
    | "pending_payment"
    | "paying"
    | "processing"
    | "paid"
    | "expired"
    | "canceled" = "all";

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
