import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { CartService } from "./cart.service";
import { ApiTags } from "@nestjs/swagger";
import { Request, Response } from "express";
import { setCartCookie } from "./utils/cart-helper";
import { CurrentUser } from "src/common/current-user.decorator";
import { JwtPayload } from "src/auth/types/jwt-payload.interface";
import { OptionalJwtAuthGuard } from "src/auth/strategies/optional-jwt.strategy";
import { AddCartItemDto } from "./dto/add-cart-item.dto";
import { UpdateCartQtyDto } from "./dto/update-cart-qty.dto";

@ApiTags("Cart")
@Controller("cart")
export class CartController {
  constructor(private readonly svc: CartService) {}
  // Define cart-related endpoints here

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  async getCart(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: JwtPayload | null,
  ) {
    const cart = await this.svc.getOrCreateCart({
      userId: user?.userId,
      cartKey: String(req?.cookies?.cartId),
      setCookie: (key, val, maxAgeSec) => setCartCookie(res, val, maxAgeSec),
    });

    return this.svc.getCartItems(String(cart._id), {
      expandStore: true,
      withAvailability: true,
    });
  }

  // upsert item
  @Post("items")
  @UseGuards(OptionalJwtAuthGuard)
  async addItem(
    @Body() dto: AddCartItemDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() payload: JwtPayload | null,
  ) {
    const cart = await this.svc.getOrCreateCart({
      userId: payload?.userId,
      cartKey: String(req?.cookies?.cartId),
      setCookie: (key, val, maxAgeSec) => setCartCookie(res, val, maxAgeSec),
    });

    return this.svc.upsertCartItem(String(cart._id), dto);
  }

  @Patch("items/:itemId")
  @UseGuards(OptionalJwtAuthGuard)
  async updateQty(
    @Param("itemId") itemId: string,
    @Body() dto: UpdateCartQtyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() payload: JwtPayload | null,
  ) {
    const cart = await this.svc.getOrCreateCart({
      userId: payload?.userId,
      cartKey: String(req?.cookies?.cartId),
      setCookie: (key, val, maxAgeSec) => setCartCookie(res, val, maxAgeSec),
    });

    return this.svc.updateQty(String(cart._id), itemId, dto);
  }

  @Delete("items/:itemId")
  @UseGuards(OptionalJwtAuthGuard)
  async removeItem(
    @Param("itemId") itemId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() payload: JwtPayload | null,
  ) {
    const cart = await this.svc.getOrCreateCart({
      userId: payload?.userId,
      cartKey: String(req?.cookies?.cartId),
      setCookie: (key, val, maxAgeSec) => setCartCookie(res, val, maxAgeSec),
    });

    return this.svc.removeItem(String(cart._id), itemId);
  }

  @Post("clear")
  @UseGuards(OptionalJwtAuthGuard)
  async clear(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() payload: JwtPayload | null,
  ) {
    const cart = await this.svc.getOrCreateCart({
      userId: payload?.userId,
      cartKey: String(req?.cookies?.cartId),
      setCookie: (key, val, maxAgeSec) => setCartCookie(res, val, maxAgeSec),
    });

    return this.svc.clearCart(String(cart._id));
  }
}
