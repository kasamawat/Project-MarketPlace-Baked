import {
  IsMongoId,
  IsInt,
  Max,
  Min,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

export class CreateReviewDto {
  @IsMongoId() masterOrderId!: string;
  @IsMongoId() storeOrderId!: string;
  @IsMongoId() storeId!: string;
  @IsMongoId() productId!: string;
  @IsOptional() @IsMongoId() skuId?: string;

  @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}
