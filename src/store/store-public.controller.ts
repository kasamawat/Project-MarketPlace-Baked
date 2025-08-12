import { Controller, Get, Param } from "@nestjs/common";
import { ApiNotFoundResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { StoreService } from "./store.service";
import { PublicStoreResponseDto } from "./dto/public-store-response.dto";
import { PublicProductResponseDto } from "src/products/dto/public-product-response.dto";

@ApiTags("Public Store")
@Controller("public/store")
export class StorePublicController {
  constructor(private readonly storeService: StoreService) {}

  // GET /public/products
  @Get()
  @ApiOkResponse({ type: [PublicStoreResponseDto] })
  async findAllStore(): Promise<PublicStoreResponseDto[]> {
    return this.storeService.findPublicStores();
  }

  // GET /public/products/:id
  @Get(":id")
  @ApiOkResponse({ type: PublicStoreResponseDto })
  @ApiNotFoundResponse({ description: "Store not found" })
  async findPublicStore(
    @Param("id") id: string,
  ): Promise<PublicStoreResponseDto> {
    return this.storeService.findPublicStore(id);
  }

  @Get(":id/products")
  @ApiOkResponse({ type: PublicProductResponseDto })
  async findPublicProductByStore(
    @Param("id") id: string,
  ): Promise<PublicProductResponseDto[]> {
    return this.storeService.findPublicProductByStore(id);
  }
}
