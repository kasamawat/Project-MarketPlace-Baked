import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  Headers,
  UseGuards,
} from "@nestjs/common";
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

  @Post("webhook")
  @HttpCode(200)
  async handleWebhook(
    @Req() req: Request, // req.body จะเป็น Buffer (เพราะใช้ bodyParser.raw ที่ main.ts)
    @Headers("stripe-signature") signature: string,
  ) {
    // 🔎 debug ชั่วคราว
    console.log(
      `[Webhook] hit len=${(req.body as Buffer)?.length ?? 0}, hasSig=${!!signature}, whsec=${(process.env.STRIPE_WEBHOOK_SECRET || "").slice(0, 7)}...`,
    );

    const event = this.svc.verifyAndParseWebhook(
      req.body as Buffer, // ✅ Buffer ดิบ
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!, // whsec_xxx
    );

    console.log(`Stripe HOOK Type: ${event.type}`);

    await this.svc.handleEvent(event);
    return { received: true };
  }

  // @Post("test")
  // @HttpCode(200)
  // async testEvent() {
  //   return this.svc.testEvent();
  // }
}
