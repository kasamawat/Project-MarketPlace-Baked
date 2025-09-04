// src/webhooks/webhooks.controller.ts
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";
import { CarrierWebhookDto } from "./dto/carrier-webhook.dto";
import { WebhooksService } from "./webhooks.service";

@Controller("webhooks")
export class WebhooksController {
  constructor(private readonly svc: WebhooksService) {}

  @Get("test")
  Test() {
    return "test";
  }

  @Post("payment")
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

  @Post("carriers/:carrierCode")
  async onCarrierWebhook(
    @Param("carrierCode") carrierCode: string,
    // @Body() body: CarrierWebhookDto, // raw payload
    @Headers("x-carrier-signature") sig: string,
    @Headers("x-carrier-timestamp") ts: string,
    @Headers("idempotency-key") idemKey: string | undefined,
    @Req() req: Request,
  ) {
    const rawBody = req.body as Buffer;

    const payload = rawBody.toString("utf-8");
    const parsed = JSON.parse(payload) as CarrierWebhookDto;

    // 1) verify signature
    const ok = this.svc.verifySignature(carrierCode, payload, ts, sig);
    if (!ok) throw new UnauthorizedException("Bad signature");

    // 2) process (idempotent inside)
    await this.svc.processCarrierEvent(carrierCode, parsed, idemKey, ts);

    return { ok: true };
  }
}
