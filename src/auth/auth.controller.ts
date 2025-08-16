// src/auth/auth.controller.ts
import {
  Controller,
  Post,
  Body,
  Res,
  Get,
  UseGuards,
  Request,
  Put,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import { Response } from "express";
import { AuthGuard } from "@nestjs/passport";
import { JwtPayload } from "./types/jwt-payload.interface";
import { CurrentUser } from "src/common/current-user.decorator";
import { User } from "src/user/schemas/user.schema";

@Controller("auth")
export class AuthController {
  constructor(private authService: AuthService) { }

  @Post("register")
  register(
    @Body() body: { username: string; email: string; password: string },
  ) {
    return this.authService.register(body);
  }

  @Post("login")
  async login(
    @Body() body: { identifier: string; password: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = await this.authService.login(body);

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production", // ใช้ https ใน production
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 วัน
    });

    return { message: "Login success" };
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

  @Put("update")
  @UseGuards(AuthGuard("jwt"))
  update(@CurrentUser() req: JwtPayload, @Body() body: Partial<User>) {
    return this.authService.update(req, body);
  }
}
