import { ApiProperty } from "@nestjs/swagger";
import { MasterStatus, StoreStatus } from "../schemas/shared.subdocs";

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
  buyerStatus!: MasterStatus;
  @ApiProperty({
    enum: ["PENDING", "PACKED", "SHIPPED", "DELIVERED", "CANCELD"],
  })
  storeStatus!: StoreStatus;
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
  @ApiProperty() cover?: ImageItemDto;
}

type ImageItemDto = {
  _id: string;
  role: string;
  order: number;
  publicId: string;
  version?: number;
  width?: number;
  height?: number;
  format?: string;
  url?: string; // ถ้าเก็บไว้
};
