import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  IsArray,
  ValidateNested,
  MaxLength,
  IsObject,
  IsBoolean,
} from "class-validator";
import { Type } from "class-transformer";

export enum ProductStatus {
  Draft = "draft",
  Pending = "pending",
  Published = "published",
  Unpublished = "unpublished",
  Rejected = "rejected",
}

export class CreateSkuDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  skuCode?: string;

  @IsObject()
  attributes!: Record<string, string>;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsBoolean()
  purchasable?: boolean;
}

export class CreateProductDto {
  @IsString() @MaxLength(150) name!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;

  @IsString() @MaxLength(100) category!: string;
  @IsString() @MaxLength(50) type!: string;

  @IsOptional() @IsString() image?: string;
  @IsOptional() @Type(() => Number) @IsNumber() defaultPrice?: number;

  // @IsMongoId() storeId!: string;
  @IsOptional() @IsEnum(ProductStatus) status?: ProductStatus;

  // โหมด B: ส่ง SKUs ตรง ๆ
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSkuDto)
  skus!: CreateSkuDto[];
}
