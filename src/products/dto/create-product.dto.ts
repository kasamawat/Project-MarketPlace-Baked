import {
  IsString,
  IsOptional,
  IsNumber,
  IsMongoId,
  ValidateNested,
} from "class-validator";
import { Types } from "mongoose";
import { IsEnum } from "class-validator";
import { Type } from "class-transformer";

export enum ProductStatus {
  Draft = "draft",
  Pending = "pending",
  Published = "published",
  Unpublished = "unpublished",
  Rejected = "rejected",
}

export class CreateProductVariantDto {
  @IsMongoId()
  _id?: Types.ObjectId;

  @IsString()
  name: string;

  @IsString()
  value: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  stock?: number;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreateProductVariantDto)
  variants?: CreateProductVariantDto[];
}

export class CreateProductDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  category: string;

  @IsString()
  type: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  stock?: number;

  @IsMongoId()
  storeId: Types.ObjectId | string;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreateProductVariantDto)
  variants?: CreateProductVariantDto[];

  @IsEnum(ProductStatus)
  status: ProductStatus;
}
