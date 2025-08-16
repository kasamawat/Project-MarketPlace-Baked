// src/products/dto/sku-batch.dto.ts
import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";

export class SkuCreateDto {
  @IsOptional()
  @IsString()
  skuCode?: string;

  // {} = base SKU
  @IsOptional()
  attributes!: Record<string, string>;

  @IsOptional()
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsBoolean()
  purchasable?: boolean;
}

export class SkuUpdateDto extends SkuCreateDto {
  @IsMongoId()
  _id!: string;
}

export class SkuBatchSyncDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SkuCreateDto)
  create?: SkuCreateDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SkuUpdateDto)
  update?: SkuUpdateDto[];

  @IsOptional()
  @IsArray()
  delete?: string[]; // skuId[]
}
