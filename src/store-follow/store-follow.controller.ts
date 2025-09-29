import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
} from "@nestjs/common";
import { StoreFollowService } from "./store-follow.service";
import { AuthGuard } from "@nestjs/passport";
import { CurrentUser } from "src/common/current-user.decorator";
import { JwtPayload } from "src/auth/types/jwt-payload.interface";

@Controller("store-follow")
export class StoreFollowController {
  constructor(private readonly storeFollowService: StoreFollowService) {}

  // POST /store-follow/:storeId
  @Post(":storeId")
  @UseGuards(AuthGuard("jwt"))
  async follow(
    @Param("storeId") storeId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.storeFollowService.follow(String(user.userId), storeId);
  }

  // DELETE /store-follow/:storeId
  @Delete(":storeId")
  @UseGuards(AuthGuard("jwt"))
  async unfollow(
    @Param("storeId") storeId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.storeFollowService.unfollow(String(user.userId), storeId);
  }

  // GET /store-follow/:storeId/status
  @Get(":storeId/status")
  @UseGuards(AuthGuard("jwt"))
  async status(
    @Param("storeId") storeId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.storeFollowService.isFollowing(String(user.userId), storeId);
  }
}
