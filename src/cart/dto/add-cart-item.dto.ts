import { ApiProperty } from "@nestjs/swagger";
import { IsMongoId, IsInt, Min } from "class-validator";

export class AddCartItemDto {
  @ApiProperty() @IsMongoId() skuId!: string;
  @ApiProperty({ default: 1 }) @IsInt() @Min(1) qty!: number;
}
