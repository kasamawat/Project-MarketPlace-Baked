import { ApiProperty } from "@nestjs/swagger";
import { IsInt, Min } from "class-validator";

export class UpdateCartQtyDto {
  @ApiProperty({ default: 1 }) @IsInt() @Min(1) qty!: number;
}
