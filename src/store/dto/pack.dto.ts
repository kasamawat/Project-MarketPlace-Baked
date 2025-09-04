// src/orders/dto/pack.dto.ts
import { Type } from "class-transformer";
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";

export class PackItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  productId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  skuId!: string;

  @IsInt()
  @IsPositive()
  qty!: number;
}

export class PackPackageDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  boxType?: string;

  @IsOptional()
  weightKg?: number;

  @IsOptional()
  dimension?: { l?: number; w?: number; h?: number };

  @IsOptional()
  @IsString()
  @MaxLength(256)
  note?: string;
}

export class PackRequestDto {
  @ValidateNested()
  @Type(() => PackPackageDto)
  package!: PackPackageDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PackItemDto)
  items!: PackItemDto[];
}
