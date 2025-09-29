// src/realtime/order-payment/order-payment.stream.controller.ts
import {
  Controller,
  Sse,
  MessageEvent,
  UseGuards,
  ForbiddenException,
  Param,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { SseBus } from "../sse.bus";
import { AuthGuard } from "@nestjs/passport"; // หรือ JwtAuthGuard ที่คุณใช้
import { CurrentUser } from "src/common/current-user.decorator";
import { JwtPayload } from "src/auth/types/jwt-payload.interface";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import {
  MasterOrder,
  MasterOrderDocument,
} from "src/orders/schemas/master-order.schema";

@Controller("realtime/order-payment")
export class OrderPaymentStreamController {
  constructor(
    private readonly bus: SseBus,
    @InjectModel(MasterOrder.name)
    private readonly masterOrderModel: Model<MasterOrderDocument>,
  ) {}

  @UseGuards(AuthGuard("jwt"))
  @Sse(":masterOrderId/stream")
  async stream(
    @CurrentUser() user: JwtPayload,
    @Param("masterOrderId") masterOrderId: string,
  ): Promise<Observable<MessageEvent>> {
    // ✅ ตรวจสิทธิ์: order ต้องเป็นของ user นี้
    const ok = await this.masterOrderModel.exists({
      _id: new Types.ObjectId(masterOrderId),
      buyerId: new Types.ObjectId(user.userId), // ใช้ user.sub ไม่ใช่ userId (ตาม payload ทั่วไป)
    });
    if (!ok) throw new ForbiddenException("Not your order");
    // แปลง NotiEvent -> SSE MessageEvent
    return this.bus
      .streamOrder(masterOrderId)
      .pipe(map((evt) => ({ data: JSON.stringify(evt) })));
  }
}
