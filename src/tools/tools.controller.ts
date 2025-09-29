// src/tools/tools.controller.ts
import { Body, Controller, Post, BadRequestException } from "@nestjs/common";
import * as crypto from "crypto";

@Controller("tools")
export class ToolsController {
  private carrierSecretMap: Record<string, string> = {
    "th-ems": process.env.CARRIER_EMS_SECRET!,
    "th-kerry": process.env.CARRIER_KERRY_SECRET!,
    "th-thunder": process.env.CARRIER_THUNDER_SECRET!,
    "th-easy": process.env.CARRIER_EASY_SECRET!,
  };

  @Post("sign")
  sign(@Body() body: { carrierCode: string; ts: string; payload: string }) {
    const { carrierCode, ts, payload } = body || {};
    if (!carrierCode || !ts || !payload) {
      throw new BadRequestException("carrierCode, ts, payload are required");
    }
    const secret = this.carrierSecretMap[carrierCode];
    if (!secret) throw new BadRequestException("Unknown carrier");

    // รูปแบบการเซ็น: base64(HMAC_SHA256(secret, `${ts}.${payload}`))
    const signature = crypto
      .createHmac("sha256", secret)
      .update(payload + ts, "utf8")
      .digest("base64");

    return { signature };
  }
}
