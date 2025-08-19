// dto/update-store-info.dto.ts
import { IsOptional, IsString, MaxLength } from "class-validator";

export class UpdateStoreBankDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  bankAccountNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  bankAccountName?: string;
}
