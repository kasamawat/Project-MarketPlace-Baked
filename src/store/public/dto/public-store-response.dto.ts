import { ApiProperty } from "@nestjs/swagger";

interface LogoImageDto {
  _id: string;
  role: string;
  order?: number;
  publicId: string;
  version?: number;
  width?: number;
  height?: number;
  format?: string;
  url?: string;
}

export class PublicStoreResponseDto {
  @ApiProperty()
  _id: string;
  @ApiProperty()
  name: string;
  @ApiProperty()
  slug: string;
  @ApiProperty({ required: false })
  logoUrl?: string;
  @ApiProperty()
  logo?: LogoImageDto;
  @ApiProperty()
  followersCount?: number;
  @ApiProperty()
  rating?: number;
}
