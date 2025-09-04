import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PaymentsService } from "./payments.service";
import { CreateIntentArgs, CreateIntentResult } from "./payment.types";
import { CreateIntentDto } from "./dto/create-intent.dto";
import { Request } from "express";
import { OptionalJwtAuthGuard } from "src/auth/strategies/optional-jwt.strategy";

type PaymentMethod = "card" | "promptpay" | "cod";

@ApiTags("Payments")
@Controller("payments")
export class PaymentsController {
  constructor(private readonly svc: PaymentsService) {}

  @Post("create-intent")
  async createIntent(
    @Body() dto: CreateIntentDto,
  ): Promise<CreateIntentResult> {
    const args: CreateIntentArgs = {
      masterOrderId: dto.masterOrderId,
      amount: dto.amount, // บาท → เดี๋ยวคูณ 100 ใน service
      customerEmail: dto.customerEmail,
      method: dto.method,
    };
    return dto.method === "promptpay"
      ? this.svc.createPromptPayIntent(args)
      : this.svc.createGeneralIntent(args);
  }

  @Post("ensure-intent")
  @UseGuards(OptionalJwtAuthGuard) // แล้วแต่ระบบ auth
  async ensureIntent(
    @Body()
    dto: {
      masterOrderId: string;
      method: Exclude<PaymentMethod, "cod">;
      customerEmail?: string;
    },
  ) {
    return this.svc.ensureIntent(dto);
  }
}
