// inventory.controller.ts (ย่อ)
import {
  Body,
  Controller,
  Param,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { InventoryService } from "./inventory.service";
import { AdjustStockDto } from "./dto/adjust-stock.dto";
import { ReserveDto } from "./dto/reserve.dto";
import { CommitDto } from "./dto/commit.dto";
import { AuthGuard } from "@nestjs/passport";
import { CurrentUser } from "src/common/current-user.decorator";
import { AdjustInventoryDto } from "./dto/adjust-inventory.dto";
import { JwtPayload } from "src/auth/types/jwt-payload.interface";

@Controller("inventory")
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class InventoryController {
  constructor(private readonly inv: InventoryService) {}

  @Post("in")
  @UseGuards(AuthGuard("jwt"))
  stockIn(@Body() dto: AdjustStockDto) {
    return this.inv.stockIn(dto.skuId, dto.qty, dto.note);
  }
  @Post("reserve")
  @UseGuards(AuthGuard("jwt"))
  reserve(@Body() dto: ReserveDto) {
    return this.inv.reserve(dto.skuId, dto.productId, dto.storeId, dto.qty, {
      cartId: dto.cartId,
      userId: dto.userId,
      ttlMinutes: dto.ttlMinutes,
    });
  }
  @Post("release")
  @UseGuards(AuthGuard("jwt"))
  release(@Body() dto: AdjustStockDto) {
    return this.inv.release(dto.skuId, dto.qty, dto.note);
  }
  @Post("commit")
  @UseGuards(AuthGuard("jwt"))
  commit(@Body() dto: CommitDto) {
    return this.inv.commit(dto.skuId, dto.qty, dto.orderId);
  }
  @Post("return")
  @UseGuards(AuthGuard("jwt"))
  returnIn(@Body() dto: CommitDto) {
    return this.inv.returnIn(dto.skuId, dto.qty, dto.orderId);
  }

  @Post("products/:productId/skus/:skuId/adjust")
  @UseGuards(AuthGuard("jwt"))
  adjustOnHand(
    @Param("productId") productId: string,
    @Param("skuId") skuId: string,
    @Body() dto: AdjustInventoryDto,
    @CurrentUser() req: JwtPayload,
  ) {
    return this.inv.adjustOnHand(productId, skuId, dto, req);
  }
}
