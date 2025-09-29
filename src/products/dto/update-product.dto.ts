import { OmitType, PartialType } from "@nestjs/mapped-types";
import { CreateProductDto } from "./create-product.dto";

// ไม่ให้แก้ skus ผ่าน DTO นี้
export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, ["skus"] as const),
) {}
