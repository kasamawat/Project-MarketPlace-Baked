import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
  Query,
  UseGuards,
} from "@nestjs/common";

import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { ProductService } from "./products.service";
import { AuthGuard } from "@nestjs/passport";
import { JwtPayload } from "src/auth/types/jwt-payload.interface";
import { CurrentUser } from "src/common/current-user.decorator";
import { ProductVariant } from "./product.schema";

@Controller("products")
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  @UseGuards(AuthGuard("jwt"))
  create(@Body() dto: CreateProductDto, @CurrentUser() req: JwtPayload) {
    return this.productService.create(dto, req);
  }

  @Get()
  @UseGuards(AuthGuard("jwt"))
  findAll(@Query() query: Record<string, any>, @CurrentUser() req: JwtPayload) {
    return this.productService.findAll(query, req);
  }

  @Get(":id")
  @UseGuards(AuthGuard("jwt"))
  findOne(@Param("id") id: string) {
    return this.productService.findOne(id);
  }

  @Put(":id")
  @UseGuards(AuthGuard("jwt"))
  update(
    @Param("id") id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() req: JwtPayload,
  ) {
    return this.productService.update(id, dto, req);
  }

  @Delete(":id")
  @UseGuards(AuthGuard("jwt"))
  remove(@Param("id") id: string) {
    return this.productService.remove(id);
  }

  @Put(":productId/variant")
  @UseGuards(AuthGuard("jwt"))
  async updateVariant(
    @Param("productId") productId: string,
    @Body("variant") variant: ProductVariant,
    @CurrentUser() user: JwtPayload,
  ) {
    // ส่งไป service
    return this.productService.updateVariant(productId, variant, user);
  }
}
