import { ApiProperty } from "@nestjs/swagger";
export class PublicProductStoreDto {
  @ApiProperty()
  _id: string;
  @ApiProperty()
  name: string;
  @ApiProperty()
  slug: string;
  @ApiProperty({ required: false })
  logoUrl?: string;
}

export class PublicProductVariantDto {
  @ApiProperty()
  _id: string;
  @ApiProperty()
  name?: string;
  @ApiProperty()
  value?: string;
  @ApiProperty({ required: false })
  image?: string;
  @ApiProperty({ required: false })
  price?: number;
  @ApiProperty({ required: false })
  stock?: number;
  @ApiProperty({ type: () => [PublicProductVariantDto], required: false })
  variants?: PublicProductVariantDto[];
}

export class PublicProductResponseDto {
  @ApiProperty()
  _id: string;
  @ApiProperty()
  name: string;
  @ApiProperty()
  image: string;
  @ApiProperty()
  price: number;
  @ApiProperty()
  category: string;
  @ApiProperty()
  type: string;
  @ApiProperty({ type: () => PublicProductStoreDto, required: false })
  store?: PublicProductStoreDto;
  @ApiProperty({ type: () => [PublicProductVariantDto], required: false })
  variants?: PublicProductVariantDto[];
}
