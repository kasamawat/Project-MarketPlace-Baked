/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { StoreService } from "./store.service";
import { CreateStoreDto } from "./dto/create-store.dto";
import { AuthGuard } from "@nestjs/passport";
import { JwtPayload } from "src/auth/types/jwt-payload.interface";
import { CurrentUser } from "src/common/current-user.decorator";
import { Response } from "express";
import { UpdateStoreInfoDto } from "./dto/update-store-info.dto";
import { UpdateStoreBankDto } from "./dto/update-store-bank.dto";
import { StoreOrdersDto } from "./dto/store-orders.dto";
import { OrdersService } from "src/orders/orders.service";
import { PackRequestDto } from "./dto/pack.dto";
import { ShipRequestDto } from "./dto/ship.dto";
import { ReportsResponseDto } from "src/orders/dto/order-report.response.dto";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { plainToInstance } from "class-transformer";
import { validateOrReject } from "class-validator";

@Controller("store")
export class StoreController {
  constructor(
    private readonly storeService: StoreService,
    private readonly ordersService: OrdersService,
  ) {}

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
    // Check user Own this store
    await this.storeService.assertOwner(req.userId, String(req.storeId));

    // get store detail (โยน 404 ถ้าไม่มี)
    const storeDetail = await this.storeService.getStore(req);
    if (!storeDetail) {
      throw new NotFoundException("Store not found");
    }

    // get storeorders (มี default กันค่ากลับมาเป็น undefined)
    const storeOrders = await this.ordersService.getStoreOrder(
      String(req.storeId),
    );

    return { storeDetail, storeOrders };
  }

  @Get("getStoreSecure")
  @UseGuards(AuthGuard("jwt"))
  async getStoreSecure(@CurrentUser() req: JwtPayload) {
    return await this.storeService.getStoreSecure(req);
  }

  @Put("updateInfo")
  @UseGuards(AuthGuard("jwt"))
  @UseInterceptors(FileInterceptor("logo", { storage: memoryStorage() }))
  async updateStoreInfo(
    @CurrentUser() user: JwtPayload,
    @Body("dto") dtoStr: string | undefined,
    @Body() fallback: any, // กรณีส่ง JSON ปกติ ไม่ใช่ multipart
    @UploadedFile() logo?: Express.Multer.File,
  ) {
    // 1) parse dto ไม่ว่าจะมาทาง dtoStr (multipart) หรือ JSON body เดิม
    const raw = dtoStr ? JSON.parse(dtoStr) : fallback;
    const dto = plainToInstance(UpdateStoreInfoDto, raw);
    await validateOrReject(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    // 2) ถ้ามีไฟล์โลโก้ แนบมาด้วยให้ตรวจสอบเบื้องต้น
    if (logo) {
      const MAX = 5 * 1024 * 1024; // 5MB
      if (!logo.mimetype?.startsWith("image/")) {
        throw new BadRequestException("logo must be an image");
      }
      if (logo.size > MAX) {
        throw new BadRequestException("logo exceeds 5MB");
      }
    }

    return await this.storeService.updateStoreInfo(dto, user, logo);
  }

  @Put("updateBank")
  @UseGuards(AuthGuard("jwt"))
  async updateStoreBank(
    @Body() dto: UpdateStoreBankDto,
    @CurrentUser() req: JwtPayload,
  ) {
    return await this.storeService.updateStoreBank(dto, req);
  }

  @Get("orders")
  @UseGuards(AuthGuard("jwt"))
  async listStoreOrders(
    @Query() q: StoreOrdersDto,
    @CurrentUser() req: JwtPayload,
  ) {
    // Check user Own this store
    await this.storeService.assertOwner(req.userId, String(req.storeId));

    return await this.ordersService.listStoreOrders(q, String(req.storeId));
  }

  @Get("orders/:storeOrderId")
  @UseGuards(AuthGuard("jwt"))
  async getStoreOrderDetail(
    @Param("storeOrderId") storeOrderId: string,
    @CurrentUser() req: JwtPayload,
  ) {
    // Check user Own this store
    await this.storeService.assertOwner(req.userId, String(req.storeId));

    return await this.ordersService.getStoreOrderDetail(
      storeOrderId,
      String(req.storeId),
    );
  }

  @Patch("orders/:storeOrderId/fulfill/pack")
  @UseGuards(AuthGuard("jwt"))
  async packStoreOrder(
    @Param("storeOrderId") storeOrderId: string,
    @CurrentUser() req: JwtPayload,
    @Body() dto: PackRequestDto,
  ) {
    await this.storeService.assertOwner(req.userId, String(req.storeId));
    return this.ordersService.packStoreOrder(
      String(req.storeId),
      storeOrderId,
      dto,
    );
  }

  @Delete("orders/:storeOrderId/fulfill/pack/:packageId")
  @UseGuards(AuthGuard("jwt"))
  async packDelete(
    @Param("storeOrderId") storeOrderId: string,
    @Param("packageId") packageId: string,
    @CurrentUser() req: JwtPayload,
  ) {
    await this.storeService.assertOwner(req.userId, String(req.storeId));
    return this.ordersService.packDelete(
      String(req.storeId),
      storeOrderId,
      packageId,
    );
  }

  @Patch("orders/:storeOrderId/fulfill/ship")
  @UseGuards(AuthGuard("jwt"))
  async shipStoreOrder(
    @Param("storeOrderId") storeOrderId: string,
    @CurrentUser() req: JwtPayload,
    @Body() dto: ShipRequestDto,
  ) {
    await this.storeService.assertOwner(req.userId, String(req.storeId));
    return this.ordersService.shipStoreOrder(
      String(req.storeId),
      storeOrderId,
      dto,
    );
  }

  @Get("reports")
  @UseGuards(AuthGuard("jwt"))
  async getReports(
    @CurrentUser() req: JwtPayload,
    @Query("from") from?: string, // YYYY-MM-DD
    @Query("to") to?: string, // YYYY-MM-DD
  ): Promise<ReportsResponseDto> {
    // ยืนยันว่า user เป็นเจ้าของร้าน
    await this.storeService.assertOwner(req.userId, String(req.storeId));
    return this.ordersService.getReports(String(req.storeId), { from, to });
  }
}
