import { ApiProperty } from "@nestjs/swagger";

export class StoreListItemDto {
  @ApiProperty() masterOrderId!: string;
  @ApiProperty() storeOrderId!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ type: () => [OrderItemPreviewDto] })
  itemsPreview!: OrderItemPreviewDto[];
  @ApiProperty() itemsCount!: number;
  @ApiProperty() itemsTotal!: number;
  @ApiProperty() currency!: string;
  @ApiProperty({
    enum: [
      "pending_payment",
      "paying",
      "processing",
      "paid",
      "expired",
      "canceled",
    ],
  })
  status!:
    | "pending_payment"
    | "paying"
    | "processing"
    | "paid"
    | "expired"
    | "canceled";
  @ApiProperty({ type: Object }) fulfillment: {
    status:
      | "UNFULFILLED"
      | "PARTIALLY_FULFILLED"
      | "FULFILLED"
      | "CANCELED"
      | "RETURNED";
    shippedItems: number;
    deliveredItems: number;
    totalItems: number;
  };
  @ApiProperty({ type: Object }) buyer: { name: string; email: string };
}

class OrderItemPreviewDto {
  @ApiProperty() name!: string;
  @ApiProperty() qty!: number;
  @ApiProperty({ required: false }) image?: string;
  @ApiProperty({ type: Object }) attributes?: Record<string, string>;
}
