import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiTags, ApiOkResponse, ApiNotFoundResponse } from "@nestjs/swagger";
import { PublicProductListQueryDto } from "./dto/public-product-list.query.dto";
import {
  PublicProductListResponseDto,
  PublicProductResponseDto,
} from "./dto/public-product-list.response.dto";
import { ProductPublicService } from "./product-public.service";
import { PublicSkuResponseDto } from "./dto/public-skus-list.response.dto";

@ApiTags("Public Products")
@Controller("public/products")
export class ProductPublicController {
  constructor(private readonly svc: ProductPublicService) {}

  // GET /public/products
  @Get()
  @ApiOkResponse({ type: PublicProductListResponseDto })
  findAll(
    @Query() q: PublicProductListQueryDto,
  ): Promise<PublicProductListResponseDto> {
    return this.svc.findPublicProducts(q);
  }

  // GET /public/products/:productId
  @Get(":productId")
  @ApiOkResponse({ type: PublicProductResponseDto })
  @ApiNotFoundResponse({ description: "Product not found" })
  async findProductPublicById(
    @Param("productId") productId: string,
  ): Promise<PublicProductResponseDto> {
    return this.svc.findProductPublicById(productId);
  }

  // GET /public/product/:productId/skus
  @Get(":productId/skus")
  @ApiOkResponse({ type: PublicSkuResponseDto })
  findSkuByProductId(
    @Param("productId") id: string,
  ): Promise<PublicSkuResponseDto[]> {
    return this.svc.findSkuByProductId(id);
  }
}
