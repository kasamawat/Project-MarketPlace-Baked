import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  Param,
  Post,
  Req,
  Res,
  Sse,
  UseGuards,
  MessageEvent,
  Get,
  NotFoundException,
} from "@nestjs/common";
import { Request, Response } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { OrdersService } from "./orders.service";
import { OptionalJwtAuthGuard } from "src/auth/strategies/optional-jwt.strategy";
import { PlaceOrderDto } from "./dto/place-order.dto";
import { CurrentUser } from "src/common/current-user.decorator";
import { setCartCookie } from "src/cart/utils/cart-helper";
import { JwtPayload } from "src/auth/types/jwt-payload.interface";
import { SseBus } from "src/realtime/sse.bus";
import { interval, map, merge, Observable } from "rxjs";
import { AuthGuard } from "@nestjs/passport";
import { toClient } from "./utils/orders-helper";

@ApiTags("Orders")
@Controller("orders")
export class OrdersController {
  constructor(
    private readonly svc: OrdersService,
    private readonly bus: SseBus,
  ) {}

  @Post("checkout")
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  async checkout(
    @Body() dto: PlaceOrderDto,
    @Headers("Idempotency-Key") idemKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() payload: JwtPayload | null,
  ) {
    const out = await this.svc.placeOrderFromCart({
      dto,
      userId: payload?.userId || "",
      cartKey: String(req?.cookies?.cartId),
      idemKey,
      setCookie: (key, val, maxAgeSec) => setCartCookie(res, val, maxAgeSec),
    });

    return out;
  }

  @Get(":orderId")
  @UseGuards(AuthGuard("jwt"))
  async getOne(
    @Param("orderId") orderId: string,
    @CurrentUser() payload: JwtPayload,
  ) {
    await this.svc.userCanSee(payload.userId, orderId);
    const order = await this.svc.findById(orderId); // lean or doc
    if (!order) throw new NotFoundException();
    return toClient(order); // เพิ่มฟิลด์ด้านล่าง
  }

  @Sse(":orderId/stream")
  @UseGuards(AuthGuard("jwt"))
  async stream(
    @Param("orderId") orderId: string,
    @Res() res: Response,
    @CurrentUser() payload: JwtPayload,
  ): Promise<Observable<MessageEvent>> {
    // ✅ auth/ownership check (สำคัญ)
    const userId = payload.userId; // แล้วแต่ guard ของคุณ
    const canSee = await this.svc.userCanSee(userId, orderId);
    if (!canSee) throw new ForbiddenException();

    // ✅ ตั้ง header กัน proxy buffer
    res.setHeader("X-Accel-Buffering", "no"); // nginx
    res.setHeader("Cache-Control", "no-cache, no-transform");

    // ✅ ส่ง heartbeat ทุก 15s กัน idle timeout
    const heartbeat$: Observable<MessageEvent> = interval(15000).pipe(
      map((): MessageEvent => ({ type: "ping", data: "keepalive" })),
    );

    // ✅ stream สถานะของ order จาก bus (หรือ change stream)
    // stream จาก bus (หรือ change stream) -> ห่อเป็น MessageEvent
    const order$: Observable<MessageEvent> = this.bus.streamOrder(orderId).pipe(
      map((payload): MessageEvent => ({ type: "status", data: payload })), // ไม่ต้อง stringify
    );

    // ส่งรวม
    return merge(heartbeat$, order$);
  }
}
