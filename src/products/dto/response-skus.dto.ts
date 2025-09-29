import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Expose, Transform } from "class-transformer";
import { Types } from "mongoose";

// helper ให้แปลง attributes ให้ปลอดภัย
function toStringRecord(v: unknown): Record<string, string> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof k === "string" && typeof val === "string") out[k] = val;
    }
    return out;
  }
  return {};
}

type ImageItemDto = {
  _id: string;
  role: "cover" | "gallery";
  order: number;
  publicId: string;
  version?: number;
  width?: number;
  height?: number;
  format?: string;
  url?: string; // ถ้าเก็บไว้
};

export type SkuLeanRaw = {
  _id: Types.ObjectId;
  skuCode?: string;
  attributes: Record<string, string>;
  price: number;
  image?: string;
  purchasable?: boolean;
  onHand?: number;
  reserved?: number;
};
/**
 * ควรสะกดเป็น SkuResponseDto (เอกพจน์/ตัวพิมพ์) ให้สม่ำเสมอ
 */
export class SkuResponseDto {
  @ApiProperty({ description: "SKU document id" })
  @Expose()
  @Transform(({ value }) => String(value))
  _id!: string;

  @ApiPropertyOptional({ description: "Human-friendly SKU code" })
  @Expose()
  skuCode?: string;

  @ApiProperty({
    description: "Attribute key-value ({} = base SKU)",
    type: "object",
    additionalProperties: { type: "string" },
    example: { Color: "Red", Size: "L" },
  })
  @Expose()
  @Transform(({ value }) => toStringRecord(value), { toClassOnly: true })
  attributes!: Record<string, string>;

  @ApiPropertyOptional({
    type: Number,
    description: "SKU price; if omitted, use product.defaultPrice",
  })
  @Expose()
  price?: number;

  @ApiPropertyOptional({ description: "Image URL for this SKU" })
  @Expose()
  image?: string;

  @ApiProperty({ default: true, description: "Is this SKU purchasable?" })
  @Expose()
  @Transform(({ value }) => (value === undefined ? true : Boolean(value)))
  purchasable!: boolean;

  // (ถ้าจะเผื่อสรุปสต๊อกไว้ด้วยในอนาคต)
  // @ApiPropertyOptional({ type: Number, description: "Available stock summary" })
  // @Expose()
  // available?: number;

  // ⭐️ อ่านสถานะสต๊อก
  @ApiProperty({ default: 0 }) @Expose() onHand!: number;
  @ApiProperty({ default: 0 }) @Expose() reserved!: number;
  @ApiProperty({ default: 0 }) @Expose() available!: number;

  @ApiProperty()
  @Expose()
  cover?: ImageItemDto;

  @ApiProperty()
  @Expose()
  images?: ImageItemDto[];
}
