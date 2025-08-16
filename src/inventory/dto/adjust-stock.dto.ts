// adjust-stock.dto.ts
import { IsMongoId, IsNumber, IsOptional, IsString } from "class-validator";
export class AdjustStockDto {
  @IsMongoId() skuId!: string;
  @IsNumber() qty!: number; // บวกสำหรับ IN
  @IsOptional() @IsString() note?: string;
}
