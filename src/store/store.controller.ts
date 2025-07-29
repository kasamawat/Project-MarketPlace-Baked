import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { StoreService } from "./store.service";
import { CreateStoreDto } from "./dto/create-store.dto";
import { AuthGuard } from "@nestjs/passport";
import { JwtPayload } from "src/auth/types/jwt-payload.interface";
import { CurrentUser } from "src/common/current-user.decorator";

@Controller("store")
export class StoreController {
  constructor(private readonly storeService: StoreService) {}

  @Post("register")
  @UseGuards(AuthGuard("jwt"))
  async createStore(
    @Body() dto: CreateStoreDto,
    @CurrentUser() req: JwtPayload,
  ) {
    return this.storeService.createStore(dto, req);
  }
}
