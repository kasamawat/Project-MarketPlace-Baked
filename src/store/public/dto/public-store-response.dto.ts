import { ApiProperty } from "@nestjs/swagger";

export class PublicStoreResponseDto {
  @ApiProperty()
  _id: string;
  @ApiProperty()
  name: string;
  @ApiProperty()
  slug: string;
  @ApiProperty({ required: false })
  logoUrl?: string;
}
