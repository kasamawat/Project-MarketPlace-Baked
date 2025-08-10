import { Controller, Get, Param } from "@nestjs/common";
import { ApiTags, ApiOkResponse, ApiNotFoundResponse } from "@nestjs/swagger";
import { ProductService } from "./products.service";
import { PublicProductResponseDto } from "./dto/public-product-response.dto";

@ApiTags("Public Products")
@Controller("public/products")
export class ProductPublicController {
  constructor(private readonly productService: ProductService) {}

  // GET /public/products
  @Get()
  @ApiOkResponse({ type: [PublicProductResponseDto] })
  async findAll(): Promise<PublicProductResponseDto[]> {
    return this.productService.findPublicProducts();
  }

  // GET /public/products/:id
  @Get(":id")
  @ApiOkResponse({ type: PublicProductResponseDto })
  @ApiNotFoundResponse({ description: "Product not found" })
  async findOne(@Param("id") id: string): Promise<PublicProductResponseDto> {
    return this.productService.findOnePublished(id);
  }
}
