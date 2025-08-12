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

@Controller("products")
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  @UseGuards(AuthGuard("jwt"))
  createProduct(@Body() dto: CreateProductDto, @CurrentUser() req: JwtPayload) {
    return this.productService.createProduct(dto, req);
  }

  @Get()
  @UseGuards(AuthGuard("jwt"))
  findAllProduct(
    @Query() query: Record<string, any>,
    @CurrentUser() req: JwtPayload,
  ) {
    return this.productService.findAllProduct(query, req);
  }

  @Get(":productId")
  @UseGuards(AuthGuard("jwt"))
  findOneProduct(@Param("productId") productId: string) {
    return this.productService.findOneProduct(productId);
  }

  @Put(":productId")
  @UseGuards(AuthGuard("jwt"))
  updateProduct(
    @Param("productId") productId: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() req: JwtPayload,
  ) {
    return this.productService.updateProduct(productId, dto, req);
  }

  @Delete(":productId")
  @UseGuards(AuthGuard("jwt"))
  removeProduct(
    @Param("productId") productId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productService.removeProduct(productId, user);
  }

  // @Put(":productId/variant")
  // @UseGuards(AuthGuard("jwt"))
  // async updateVariant(
  //   @Param("productId") productId: string,
  //   @Body("variant") variantDto: UpdateProductVariantDto,
  //   @CurrentUser() user: JwtPayload,
  // ) {
  //   // ส่งไป service
  //   return this.productService.updateVariant(productId, variantDto, user);
  // }

  // @Delete(":productId/variant/:variantId")
  // @UseGuards(AuthGuard("jwt"))
  // async removeVariant(
  //   @Param("productId") productId: string,
  //   @Param("variantId") variantId: string,
  //   @CurrentUser() user: JwtPayload,
  // ) {
  //   return this.productService.removeVariant(productId, variantId, user);
  // }
}
