// commit.dto.ts
import { IsMongoId, IsNumber, IsString } from "class-validator";
export class CommitDto {
  @IsMongoId() skuId!: string;
  @IsNumber() qty!: number;
  @IsString() orderId!: string;
}
