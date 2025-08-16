// src/products/public/dto/public-skus-list.response.dto.ts
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Expose, Transform } from "class-transformer";

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

export class PublicSkuResponseDto {
  @ApiProperty()
  @Expose()
  @Transform(({ value }) => String(value))
  _id!: string;

  @ApiPropertyOptional()
  @Expose()
  skuCode?: string;

  @ApiProperty({
    type: Object,
    additionalProperties: { type: "string" },
    description: "เช่น { Color: 'Red', Size: 'L' } หรือ {} สำหรับ base SKU",
  })
  @Expose()
  @Transform(({ value }) => toStringRecord(value), { toClassOnly: true })
  attributes!: Record<string, string>;

  @ApiPropertyOptional({ description: "ราคาเฉพาะ SKU (ถ้าไม่มีให้ omit)" })
  @Expose()
  @Transform(({ value }) => (typeof value === "number" ? value : undefined), {
    toClassOnly: true,
  })
  price?: number;

  @ApiPropertyOptional()
  @Expose()
  image?: string;

  @ApiProperty({ default: true })
  @Expose()
  @Transform(({ value }) => (typeof value === "boolean" ? value : true), {
    toClassOnly: true,
  })
  purchasable!: boolean;

  @ApiProperty({ description: "จำนวนที่ซื้อได้จริง (onHand - reserved)" })
  @Expose()
  @Transform(
    ({ value }) =>
      typeof value === "number" && value > 0 ? Math.floor(value) : 0,
    { toClassOnly: true },
  )
  available!: number;

  @ApiPropertyOptional({ example: "THB" })
  @Expose()
  currency?: string;
}

// ถ้าจะรองรับการแบ่งหน้าในอนาคต ใส่ wrapper แบบนี้
// export class PublicSkusListResponseDto {
//   @ApiProperty({ type: [PublicSkuResponseDto] })
//   @Expose()
//   items!: PublicSkuResponseDto[];

//   // เผื่อไว้ ถ้ามี pagination ในอนาคต
//   @ApiPropertyOptional()
//   @Expose()
//   total?: number;
// }
