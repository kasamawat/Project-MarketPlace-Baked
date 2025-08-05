import { IsString, IsOptional, IsNumber } from "class-validator";
import { Types } from "mongoose";

export class CreateProductVariantDto {
  @IsString()
  _id?: Types.ObjectId;

  @IsString()
  name: string;

  @IsString()
  value: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsNumber()
  stock?: number;

  @IsOptional()
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
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsNumber()
  stock?: number;

  @IsString()
  storeId: Types.ObjectId | string;

  @IsOptional()
  variants?: CreateProductVariantDto[]; // ควร define type ให้ละเอียดขึ้น
}
