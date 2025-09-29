/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Controller,
  Body,
  UseGuards,
  Put,
  Get,
  Post,
  Param,
  Patch,
  Delete,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from "@nestjs/common";
import { Response, Request } from "express";
import { AuthGuard } from "@nestjs/passport";
import { CurrentUser } from "src/common/current-user.decorator";
import { JwtPayload } from "src/auth/types/jwt-payload.interface";
import { UserService } from "./user.service";
import { AddressInfoDto } from "./dto/address-info.dto";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { UpdateUserInfoDto } from "./dto/user-update-info.dto";
import { plainToInstance } from "class-transformer";

@Controller("user")
export class UserController {
  constructor(private userService: UserService) {}

  @Get("getProfileSecure")
  @UseGuards(AuthGuard("jwt"))
  getProfile(@CurrentUser() req: JwtPayload) {
    return this.userService.getProfile(req);
  }

  @Put("update")
  @UseGuards(AuthGuard("jwt"))
  @UseInterceptors(FileInterceptor("avatar", { storage: memoryStorage() }))
  async updateUserInfo(
    @CurrentUser() user: JwtPayload,
    @Body("dto") dtoStr: string | undefined,
    @Body() fallback: any, // กรณีส่ง JSON ปกติ ไม่ใช่ multipart
    @UploadedFile() avatar?: Express.Multer.File,
  ) {
    const raw = dtoStr ? JSON.parse(dtoStr) : fallback;
    const dto = plainToInstance(UpdateUserInfoDto, raw);
    // await validateOrReject(dto, {
    //   whitelist: true,
    //   forbidNonWhitelisted: true,
    // });

    // 2) ถ้ามีไฟล์โลโก้ แนบมาด้วยให้ตรวจสอบเบื้องต้น
    if (avatar) {
      const MAX = 5 * 1024 * 1024; // 5MB
      if (!avatar.mimetype?.startsWith("image/")) {
        throw new BadRequestException("logo must be an image");
      }
      if (avatar.size > MAX) {
        throw new BadRequestException("logo exceeds 5MB");
      }
    }

    return await this.userService.updateUserInfo(user, dto, avatar);
  }

  @Get("addresses")
  @UseGuards(AuthGuard("jwt"))
  getAddress(@CurrentUser() user: JwtPayload) {
    return this.userService.getAddresses(user);
  }

  @Post("addresses")
  @UseGuards(AuthGuard("jwt"))
  addAddress(@CurrentUser() user: JwtPayload, @Body() dto: AddressInfoDto) {
    return this.userService.addAddress(user, dto);
  }

  @Put("addresses/:addressId")
  @UseGuards(AuthGuard("jwt"))
  updateAddress(
    @CurrentUser() user: JwtPayload,
    @Param("addressId") addressId: string,
    @Body() dto: AddressInfoDto,
  ) {
    return this.userService.updateAddress(user, addressId, dto);
  }

  @Patch("addresses/:addressId/default")
  @UseGuards(AuthGuard("jwt"))
  setDefaultAddress(
    @CurrentUser() user: JwtPayload,
    @Param("addressId") addressId: string,
  ) {
    return this.userService.setDefaultAddress(user, addressId);
  }

  @Delete("addresses/:addressId")
  @UseGuards(AuthGuard("jwt"))
  deleteAddress(
    @CurrentUser() user: JwtPayload,
    @Param("addressId") addressId: string,
  ) {
    return this.userService.deleteAddress(user, addressId);
  }
}
