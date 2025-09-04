import {
  Body,
  Controller,
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
  Query,
  BadRequestException,
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
import {
  filter,
  ignoreElements,
  interval,
  map,
  merge,
  Observable,
  share,
  take,
} from "rxjs";
import { AuthGuard } from "@nestjs/passport";
import { ListOrdersDto } from "./dto/list-orders.dto";

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
    if (idemKey && idemKey.length > 120) {
      throw new BadRequestException("Invalid Idempotency-Key");
    }

    const out = await this.svc.checkoutMaster({
      dto,
      userId: payload?.userId || "",
      cartKey: String(req?.cookies?.cartId),
      idemKey,
      setCookie: (key, val, maxAgeSec) => setCartCookie(res, val, maxAgeSec),
    });

    return out;
  }

  @Get()
  @UseGuards(AuthGuard("jwt"))
  async listForBuyer(
    @Query() q: ListOrdersDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.svc.listForBuyer(user.userId, q);
  }

  @Get(":masterOrderId/result")
  @UseGuards(AuthGuard("jwt"))
  async getBuyerMasterOrder(
    @Param("masterOrderId") masterOrderId: string,
    @CurrentUser() payload: JwtPayload,
  ) {
    await this.svc.userCanSeeMaster(payload.userId, masterOrderId);
    const data = await this.svc.getBuyerMasterOrder(masterOrderId);
    if (!data) throw new NotFoundException();
    return data; // = toClient() แล้วใน service
  }

  @Get(":masterOrderId/:storeOrderId/list")
  @UseGuards(AuthGuard("jwt"))
  async getBuyerOrderDetail(
    @Param("masterOrderId") masterOrderId: string,
    @Param("storeOrderId") storeOrderId: string,
    @CurrentUser() payload: JwtPayload,
  ) {
    await this.svc.userCanSeeMaster(payload.userId, masterOrderId);
    await this.svc.userCanSeeStore(payload.userId, storeOrderId);
    const data = await this.svc.getBuyerOrderDetail(
      masterOrderId,
      storeOrderId,
    );
    if (!data) throw new NotFoundException();
    return data; // = toClient() แล้วใน service
  }

  /** คืนข้อมูลที่หน้า /checkout/pay ต้องใช้ */
  @Get(":masterOrderId/pay-meta")
  @UseGuards(OptionalJwtAuthGuard) // guest ก็เรียกได้ แต่จะบล็อคถ้า order มี userId ไม่ตรง
  async getPayMetaForMaster(
    @Param("masterOrderId") masterOrderId: string,
    @CurrentUser() payload: JwtPayload | null,
  ) {
    const userId = payload?.userId || undefined;
    return this.svc.getPayMetaForMaster(masterOrderId, userId);
  }

  @Sse(":masterOrderId/stream")
  @UseGuards(AuthGuard("jwt"))
  async stream(
    @Param("masterOrderId") masterOrderId: string,
    @Res() res: Response,
    @CurrentUser() payload: JwtPayload,
  ): Promise<Observable<MessageEvent>> {
    // ✅ auth/ownership check (สำคัญ)
    const userId = payload.userId; // แล้วแต่ guard ของคุณ
    await this.svc.userCanSeeMaster(userId, masterOrderId);

    // ✅ ตั้ง header กัน proxy buffer
    res.setHeader("X-Accel-Buffering", "no"); // nginx
    res.setHeader("Cache-Control", "no-cache, no-transform");

    // ✅ stream สถานะของ order จาก bus (หรือ change stream)
    // stream จาก bus (หรือ change stream) -> ห่อเป็น MessageEvent
    const order$ = this.bus.streamOrder(masterOrderId).pipe(
      map((payload): MessageEvent => ({ type: "order", data: payload })),
      share(), // ไม่ต้อง stringify
    );

    // when find last status -> close stream
    const terminal$ = order$.pipe(
      filter((e) => {
        if (!e?.data) return false;
        const d = typeof e.data === "string" ? { status: e.data } : e.data;
        const s = (d as Record<string, string>).status as string | undefined;
        return s === "paid" || s === "canceled" || s === "expired";
      }),
      take(1),
    );

    // ✅ ส่ง heartbeat ทุก 15s กัน idle timeout
    const heartbeat$ = interval(15000).pipe(
      map((): MessageEvent => ({ type: "keepalive", data: "1" })),
    );
    // ส่งรวม
    return merge(heartbeat$, order$, terminal$.pipe(ignoreElements()));
  }
}
