// add-skus.dto.ts
import { IsArray, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { CreateSkuDto } from "../../products/dto/create-product.dto";

export class AddSkusDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSkuDto)
  skus!: CreateSkuDto[];
}
