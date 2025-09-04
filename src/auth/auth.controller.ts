// src/auth/auth.controller.ts
import {
  Controller,
  Post,
  Body,
  Res,
  Get,
  UseGuards,
  Req,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import { Response, Request } from "express";
import { AuthGuard } from "@nestjs/passport";
import { JwtPayload } from "./types/jwt-payload.interface";
import { CurrentUser } from "src/common/current-user.decorator";
import { CartResolverService } from "src/cart/common/cart-resolver.service";
import { LoginDto } from "./dto/auth.dto";
import { setAuthCookie } from "./utils/auth-helper";

@Controller("auth")
export class AuthController {
  constructor(
    private authService: AuthService,
    private cartService: CartResolverService,
  ) {}

  @Post("register")
  register(
    @Body() body: { username: string; email: string; password: string },
  ) {
    return this.authService.register(body);
  }

  @Post("login")
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, storeId } = await this.authService.validateUser(
      dto.identifier,
      dto.password,
    );

    const token = this.authService.issueJwt({
      userId: String(user._id),
      username: user.username,
      email: user.email,
      storeId: storeId == null ? "" : String(storeId), // string | null
    });

    // ✅ ตั้ง cookie ชื่อ 'token' ให้ JwtStrategy อ่านได้
    setAuthCookie(res, token, 7 * 24 * 60 * 60); // 7 วัน

    // 🔁 ถ้ามี guest cart ใน cookie -> รวมเข้ากับ cart ของ user แล้วเคลียร์ cookie cartId
    await this.cartService.mergeGuestCartToUser({
      userId: String(user._id),
      cartKey: (req.cookies?.cartId as string) ?? null,
      clearCookie: () => res.clearCookie("cartId", { path: "/" }),
    });

    return {
      ok: true,
      user: {
        id: String(user._id),
        username: user.username,
        email: user.email,
        storeId,
      },
    };
  }

  @Post("logout")
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie("token");
    return { message: "Logout success" };
  }

  @Get("getProfile")
  @UseGuards(AuthGuard("jwt"))
  getProfile(@CurrentUser() req: JwtPayload) {
    return this.authService.getProfile(req);
  }

  // @Put("update")
  // @UseGuards(AuthGuard("jwt"))
  // update(@CurrentUser() req: JwtPayload, @Body() body: Partial<User>) {
  //   return this.authService.update(req, body);
  // }
}
