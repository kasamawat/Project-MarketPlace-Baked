// src/webhooks/dto/carrier-webhook.dto.ts
import {
  IsString,
  IsOptional,
  IsISO8601,
  IsIn,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class CarrierCheckpointDto {
  @IsString() status!: string; // raw carrier status
  @IsOptional() @IsISO8601() at?: string; // event time
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() message?: string;
}

export class CarrierWebhookDto {
  @IsString() trackingNumber!: string;
  @IsOptional() @IsString() carrier?: string; // ex. TH-EMS, TH-KERRY
  @IsIn([
    "info_received",
    "in_transit",
    "out_for_delivery",
    "delivered",
    "failed",
    "returned",
  ])
  event!:
    | "info_received"
    | "in_transit"
    | "out_for_delivery"
    | "delivered"
    | "failed"
    | "returned";

  @IsOptional() @IsISO8601() eventAt?: string;

  // optional: อาจมีหลายชิ้น/หลายกล่องใน tracking เดียว (ปกติ 1:1)
  @ValidateNested({ each: true })
  @Type(() => CarrierCheckpointDto)
  checkpoints?: CarrierCheckpointDto[];

  // ป้องกัน replay / ทำ idempotency
  @IsString() eventId!: string; // จาก carrier ถ้ามี; ถ้าไม่มี ให้คุณ gen เองจาก (carrier,tracking,event,timestamp)
}
