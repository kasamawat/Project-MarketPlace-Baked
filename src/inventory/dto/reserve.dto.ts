// reserve.dto.ts
import { IsMongoId, IsNumber, IsOptional, IsString } from "class-validator";
export class ReserveDto {
  @IsMongoId() skuId!: string;
  @IsMongoId() productId!: string;
  @IsMongoId() storeId!: string;
  @IsMongoId() masterOrderId!: string;
  @IsNumber() qty!: number;
  @IsOptional() @IsString() cartId?: string;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsNumber() ttlMinutes?: number; // เวลาในการกัน
}
