// update-sku.dto.ts
import { PartialType } from "@nestjs/mapped-types";
import { CreateSkuDto } from "../../products/dto/create-product.dto";
import { IsMongoId } from "class-validator";

export class UpdateSkuDto extends PartialType(CreateSkuDto) {
  @IsMongoId() skuId!: string;
}
