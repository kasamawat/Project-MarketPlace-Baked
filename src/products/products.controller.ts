// products.controller.ts
import {
  BadRequestException,
  Body,
  ClassSerializerInterceptor,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { ProductsService } from "./products.service";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { JwtPayload } from "src/auth/types/jwt-payload.interface";
import { AuthGuard } from "@nestjs/passport";
import { CurrentUser } from "src/common/current-user.decorator";
import { ListProductsQueryDto } from "./dto/list-products.query";
import { isValidObjectId } from "mongoose";
import { plainToInstance } from "class-transformer";
import { ProductDetailResponseDto } from "./dto/response-product.dto";
import { SkuResponseDto } from "./dto/response-skus.dto";
import { SkuBatchSyncDto } from "./dto/sku-batch.dto";

@Controller("products")
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class ProductsController {
  constructor(private readonly svc: ProductsService) {}

  @Post()
  @UseGuards(AuthGuard("jwt"))
  create(@Body() dto: CreateProductDto, @CurrentUser() req: JwtPayload) {
    return this.svc.createWithSkus(dto, req);
  }

  @Put(":productId")
  @UseGuards(AuthGuard("jwt"))
  update(
    @Param("productId") id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() req: JwtPayload,
  ) {
    return this.svc.update(id, dto, req);
  }

  @Put(":productId/skus/batch")
  @UseGuards(AuthGuard("jwt"))
  syncSkus(
    @Param("productId") id: string,
    @Body() dto: SkuBatchSyncDto,
    @CurrentUser() req: JwtPayload,
  ) {
    return this.svc.syncSkus(id, dto, req);
  }

  @Delete(":productId")
  @UseGuards(AuthGuard("jwt"))
  deleteProduct(
    @Param("productId") productId: string,
    @CurrentUser() req: JwtPayload,
  ) {
    return this.svc.deleteProduct(productId, req);
  }

  @Get()
  @UseGuards(AuthGuard("jwt"))
  productList(
    @Query() query: ListProductsQueryDto,
    @CurrentUser() req: JwtPayload,
  ) {
    return this.svc.listForStore(query, req);
  }

  @Get(":productId")
  @UseGuards(AuthGuard("jwt"))
  @UseInterceptors(ClassSerializerInterceptor)
  async productByProductId(
    @Param("productId") productId: string,
    @CurrentUser() req: JwtPayload,
  ) {
    if (!isValidObjectId(productId)) {
      throw new BadRequestException("Invalid productId");
    }

    const doc = await this.svc.productByProductId(productId, req);

    return plainToInstance(ProductDetailResponseDto, doc, {
      excludeExtraneousValues: true,
    });
  }

  @Get(":productId/skus")
  @UseGuards(AuthGuard("jwt"))
  @UseInterceptors(ClassSerializerInterceptor)
  async listSkusByProductId(
    @Param("productId") productId: string,
    @CurrentUser() req: JwtPayload,
  ) {
    if (!isValidObjectId(productId))
      throw new BadRequestException("Invalid productId");

    const doc = await this.svc.listSkusByProductId(productId, req);
    return plainToInstance(SkuResponseDto, doc, {
      excludeExtraneousValues: true,
    });
  }
}
