// src/images/dto/attach-image.dto.ts
import {
  IsEnum,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";
import { ImageEntityType, ImageRole, ImageVisibility } from "../image.enums";

export class AttachImageDto {
  @IsEnum(ImageEntityType) entityType!: ImageEntityType;
  @IsMongoId() entityId!: string;

  @IsEnum(ImageRole) role: ImageRole = ImageRole.Gallery;

  @IsOptional() @IsNumber() order?: number;

  @IsMongoId() storeId?: string;
  // cloudinary meta
  @IsString() @MaxLength(500) publicId!: string;
  @IsString() @MaxLength(2000) url!: string;
  @IsOptional() @IsNumber() width?: number;
  @IsOptional() @IsNumber() height?: number;
  @IsOptional() @IsNumber() bytes?: number;
  @IsOptional() @IsString() format?: string;
  @IsOptional() @IsNumber() version?: number;
  @IsOptional() @IsString() etag?: string;

  @IsOptional() @IsEnum(ImageVisibility) visibility?: ImageVisibility;
}
