// dto/update-store-info.dto.ts
import {
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from "class-validator";

export class UpdateStoreInfoDto {
  @IsOptional()
  @IsString()
  @Length(2, 80)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/) // a-z 0-9 -
  @Length(2, 64)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  returnPolicy?: string;
}
