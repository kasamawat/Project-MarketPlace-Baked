import { IsOptional, IsString, MaxLength } from "class-validator";
import { FulfillStatus } from "src/orders/schemas/shared.subdocs";

export class UpdateStoreFulfill {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  skuId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  status?: FulfillStatus;
}
