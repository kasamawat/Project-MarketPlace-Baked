// src/orders/dto/ship.dto.ts
import { Type } from "class-transformer";
import {
  IsArray,
  ArrayNotEmpty,
  IsIn,
  IsOptional,
  IsString,
  IsNotEmpty,
  MaxLength,
} from "class-validator";

export class ShipMetaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  carrier!: string; // e.g. TH-EMS, TH-KERRY

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  trackingNumber!: string;

  @IsOptional()
  @IsIn(["DROP_OFF", "PICKUP"])
  method?: "DROP_OFF" | "PICKUP";

  /** ISO string */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  shippedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  note?: string;
}

export class ShipRequestDto {
  @Type(() => ShipMetaDto)
  shipment!: ShipMetaDto;

  @IsArray()
  @ArrayNotEmpty()
  packageIds!: string[]; // _id ของ fulfillment.packages[]
}
