import { ApiProperty } from "@nestjs/swagger";
import { PublicStoreResponseDto } from "src/store/dto/public-store-response.dto";

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
  description: string;
  @ApiProperty()
  image: string;
  @ApiProperty()
  price: number;
  @ApiProperty()
  category: string;
  @ApiProperty()
  type: string;
  @ApiProperty({ type: () => PublicStoreResponseDto, required: false })
  store?: PublicStoreResponseDto;
  @ApiProperty({ type: () => [PublicProductVariantDto], required: false })
  variants?: PublicProductVariantDto[];
}
