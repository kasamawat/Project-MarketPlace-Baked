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
} from "@nestjs/common";
import { Response, Request } from "express";
import { AuthGuard } from "@nestjs/passport";
import { CurrentUser } from "src/common/current-user.decorator";
import { User } from "src/user/schemas/user.schema";
import { JwtPayload } from "src/auth/types/jwt-payload.interface";
import { UserService } from "./user.service";
import { AddressInfoDto } from "./dto/address-info.dto";

@Controller("user")
export class UserController {
  constructor(private userService: UserService) {}

  @Put("update")
  @UseGuards(AuthGuard("jwt"))
  updateUserInfo(@CurrentUser() req: JwtPayload, @Body() body: Partial<User>) {
    return this.userService.updateUserInfo(req, body);
  }

  @Get("addresses")
  @UseGuards(AuthGuard("jwt"))
  getAddress(@CurrentUser() req: JwtPayload) {
    return this.userService.getAddresses(req);
  }

  @Post("addresses")
  @UseGuards(AuthGuard("jwt"))
  addAddress(@CurrentUser() req: JwtPayload, @Body() dto: AddressInfoDto) {
    return this.userService.addAddress(req, dto);
  }

  @Put("addresses/:addressId")
  @UseGuards(AuthGuard("jwt"))
  updateAddress(
    @CurrentUser() req: JwtPayload,
    @Param("addressId") addressId: string,
    @Body() dto: AddressInfoDto,
  ) {
    return this.userService.updateAddress(req, addressId, dto);
  }

  @Patch("addresses/:addressId/default")
  @UseGuards(AuthGuard("jwt"))
  setDefaultAddress(
    @CurrentUser() req: JwtPayload,
    @Param("addressId") addressId: string,
  ) {
    return this.userService.setDefaultAddress(req, addressId);
  }

  @Delete("addresses/:addressId")
  @UseGuards(AuthGuard("jwt"))
  deleteAddress(
    @CurrentUser() req: JwtPayload,
    @Param("addressId") addressId: string,
  ) {
    return this.userService.deleteAddress(req, addressId);
  }
}
