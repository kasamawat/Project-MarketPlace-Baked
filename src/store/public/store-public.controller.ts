import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiNotFoundResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { PublicStoreResponseDto } from "./dto/public-store-response.dto";
import { StorePublicService } from "./store-public.service";
import { PublicProductListResponseDto } from "src/products/public/dto/public-product-list.response.dto";
import { PublicProductListQueryDto } from "src/products/public/dto/public-product-list.query.dto";

@ApiTags("Public Store")
@Controller("public/store")
export class StorePublicController {
  constructor(private readonly storePublicService: StorePublicService) {}

  // GET /public/products
  @Get()
  @ApiOkResponse({ type: [PublicStoreResponseDto] })
  async findAllStore(): Promise<PublicStoreResponseDto[]> {
    return this.storePublicService.findPublicStores();
  }

  // GET /public/products/:idOrSlug
  @Get(":idOrSlug")
  @ApiOkResponse({ type: PublicStoreResponseDto })
  @ApiNotFoundResponse({ description: "Store not found" })
  // idOrSlug รับได้ทั้ง slug และ Mongo ObjectId
  async findPublicStore(
    @Param("idOrSlug") idOrSlug: string,
  ): Promise<PublicStoreResponseDto> {
    return this.storePublicService.findPublicStore(idOrSlug);
  }

  @Get(":idOrSlug/products")
  @ApiOkResponse({ type: PublicProductListResponseDto })
  async findPublicProductByStore(
    @Query() q: PublicProductListQueryDto,
    @Param("idOrSlug") idOrSlug: string,
  ): Promise<PublicProductListResponseDto> {
    return this.storePublicService.findPublicProductByStore(q, idOrSlug);
  }
}
