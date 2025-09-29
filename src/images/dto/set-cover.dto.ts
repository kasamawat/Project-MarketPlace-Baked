// src/images/dto/set-cover.dto.ts
import { IsEnum, IsMongoId } from "class-validator";
import { ImageEntityType } from "../image.enums";

export class SetCoverDto {
  @IsEnum(ImageEntityType) entityType!: ImageEntityType;
  @IsMongoId() entityId!: string;

  @IsMongoId() storeId!: string;

  // เลือกจาก existing image (อ้างจาก id ของ images collection)
  @IsMongoId() imageId!: string;
}
