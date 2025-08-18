import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CartItemResponseDto {
  @ApiProperty() _id!: string; // cartItem id
  @ApiProperty() productId!: string;
  @ApiProperty() skuId!: string;
  @ApiProperty() storeId!: string;

  @ApiProperty() productName!: string;
  @ApiPropertyOptional() productImage?: string;
  @ApiProperty() unitPrice!: number;
  @ApiProperty() quantity!: number;
  @ApiProperty() subtotal!: number;
  @ApiPropertyOptional({ type: Object }) attributes?: Record<string, string>;
}

export class CartResponseDto {
  @ApiProperty() cartId!: string;
  @ApiProperty() itemsCount!: number;
  @ApiProperty() itemsTotal!: number;
  @ApiProperty() currency!: string;
  @ApiProperty({ type: [CartItemResponseDto] }) items!: CartItemResponseDto[];
}
