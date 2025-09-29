// response-product.dto.ts
import { ApiProperty } from "@nestjs/swagger";
import { Expose, Transform } from "class-transformer";
import { Types } from "mongoose";
// import { ProductStatus } from "../dto/create-product.dto";

type ImageItemDto = {
  _id: string;
  role: string;
  order: number;
  publicId: string;
  version?: number;
  width?: number;
  height?: number;
  format?: string;
  url?: string; // ถ้าเก็บไว้
};

export type ProductLeanRaw = {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  category: string;
  type: string;
  image?: string;
  storeId?: string;
  defaultPrice?: number;
  status: string;
  createdAt: Date; // << ต้องเป็น Date
  updatedAt: Date; // << ต้องเป็น Date
};

export type ImagesLeanRaw = {
  _id: Types.ObjectId;
  role: string;
  order: number;
  entityType?: string;
  entityId?: Types.ObjectId;
  publicId: string;
  version?: number;
  width?: number;
  height?: number;
  format?: string;
  url?: string; // ถ้าเก็บไว้
};

export class ProductDetailResponseDto {
  @ApiProperty()
  @Expose()
  @Transform(({ value }) => String(value))
  _id!: string;

  @ApiProperty() @Expose() name!: string;
  @ApiProperty({ required: false }) @Expose() description?: string;
  @ApiProperty() @Expose() category!: string;
  @ApiProperty() @Expose() type!: string;
  @ApiProperty({ required: false }) @Expose() image?: string;
  @ApiProperty({ required: false }) @Expose() defaultPrice?: number;
  @ApiProperty({
    enum: ["draft", "pending", "published", "unpublished", "rejected"],
  })
  @Expose()
  status!: string;

  @ApiProperty()
  @Expose()
  @Transform(({ value }) => new Date(value).toISOString())
  createdAt!: string;

  @ApiProperty()
  @Expose()
  @Transform(({ value }) => new Date(value).toISOString())
  updatedAt!: string;

  @ApiProperty()
  @Expose()
  cover?: ImageItemDto;

  @ApiProperty()
  @Expose()
  images?: ImageItemDto[];
}
