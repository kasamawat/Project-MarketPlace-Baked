// src/modules/products/dto/list-products.query.ts
import { Transform, Type } from "class-transformer";
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  Max,
  IsIn,
} from "class-validator";
import { ProductStatus } from "../dto/create-product.dto"; // หรือ import จากตำแหน่งที่คุณประกาศ enum

export class ListProductsQueryDto {
  @IsOptional()
  @IsString()
  q?: string; // search by name (contains)

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @IsIn(["newest", "oldest", "name_asc", "name_desc"])
  sort?: "newest" | "oldest" | "name_asc" | "name_desc";

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(1000)
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => value === "1" || value === "true")
  includeSkuCount?: boolean; // ?includeSkuCount=1
}
