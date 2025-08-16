// src/products/public/dto/public-product-list.response.dto.ts
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Expose } from "class-transformer";

export class PublicProductResponseDto {
  @ApiProperty() @Expose() _id!: string;
  @ApiProperty() @Expose() name!: string;
  @ApiPropertyOptional() @Expose() image?: string;
  @ApiProperty() @Expose() description?: string;

  @ApiPropertyOptional() @Expose() priceFrom?: number;
  @ApiPropertyOptional() @Expose() priceTo?: number;

  @ApiProperty() @Expose() skuCount!: number;

  @ApiProperty() @Expose() storeId?: string;
  @ApiProperty()
  @Expose()
  store?: { storeId?: string; name?: string; slug?: string };
}

export class PublicProductListResponseDto {
  @ApiProperty({ type: [PublicProductResponseDto] })
  @Expose()
  items!: PublicProductResponseDto[];

  @ApiProperty() @Expose() total!: number;
  @ApiProperty() @Expose() page!: number;
  @ApiProperty() @Expose() limit!: number;
}
