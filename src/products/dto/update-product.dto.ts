import { PartialType } from "@nestjs/mapped-types";
import {
  CreateProductDto,
  CreateProductVariantDto,
} from "./create-product.dto";

export class UpdateProductDto extends PartialType(CreateProductDto) {}
export class UpdateProductVariantDto extends PartialType(
  CreateProductVariantDto,
) {}
