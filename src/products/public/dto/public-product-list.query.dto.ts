// src/products/public/dto/public-product-list.query.dto.ts
import { IsInt, IsOptional, IsString, IsIn, Min } from "class-validator";
import { Type } from "class-transformer";

export class PublicProductListQueryDto {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsString() category?: string;

  @IsOptional()
  @IsIn(["new", "price_asc", "price_desc"])
  sort?: "new" | "price_asc" | "price_desc" = "new";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 24;
}
