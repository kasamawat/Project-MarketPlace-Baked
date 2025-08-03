import { Body, Controller, Get, Post, Res, UseGuards } from "@nestjs/common";
import { StoreService } from "./store.service";
import { CreateStoreDto } from "./dto/create-store.dto";
import { AuthGuard } from "@nestjs/passport";
import { JwtPayload } from "src/auth/types/jwt-payload.interface";
import { CurrentUser } from "src/common/current-user.decorator";
import { Response } from "express";

@Controller("store")
export class StoreController {
  constructor(private readonly storeService: StoreService) { }

  @Post("register")
  @UseGuards(AuthGuard("jwt"))
  async createStore(
    @Body() dto: CreateStoreDto,
    @CurrentUser() req: JwtPayload,
    @Res({ passthrough: true }) res: Response, // 👈 สำหรับ set cookie
  ) {
    const token = await this.storeService.createStore(dto, req);

    // set cookie token ใหม่
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 วัน
    });

    return { message: "Register Store Success", token };
  }

  @Get("getStore")
  @UseGuards(AuthGuard("jwt"))
  async getStore(@CurrentUser() req: JwtPayload) {
    return await this.storeService.getStore(req);
  }

  @Get("getStoreSecure")
  @UseGuards(AuthGuard("jwt"))
  async getStoreSecure(@CurrentUser() req: JwtPayload) {
    return await this.storeService.getStoreSecure(req);
  }
}
