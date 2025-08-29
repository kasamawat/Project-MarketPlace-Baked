// payments/dto/create-intent.dto.ts
import {
  IsNumber,
  IsOptional,
  IsString,
  IsEmail,
  IsEnum,
} from "class-validator";
import { PaymentMethodKind } from "../payment.types";

export class CreateIntentDto {
  @IsString() masterOrderId!: string;

  // แนะนำให้บังคับเป็นจำนวนเต็มสตางค์ตั้งแต่ชั้น Controller ก็ได้ (ดูตัวเลือกด้านล่าง)
  @IsNumber() amount!: number; // บาท

  @IsOptional() @IsEmail() customerEmail?: string;

  @IsEnum(["general", "promptpay"] as const)
  method!: PaymentMethodKind;
}
