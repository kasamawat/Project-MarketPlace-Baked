// src/orders/dto/buyer-order-list.dto.ts
import { ApiProperty } from "@nestjs/swagger";

export class BuyerListItemDto {
  @ApiProperty() masterOrderId!: string;
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
      "shipped",
      "delivered",
      "expired",
      "canceled",
    ],
  })
  userStatus!:
    | "pending_payment"
    | "paying"
    | "processing"
    | "paid"
    | "shipped"
    | "delivered"
    | "expired"
    | "canceled";
  @ApiProperty({ required: false }) reservationExpiresAt?: string;
  @ApiProperty() storesSummary?: StoreSummaryDto[];
  @ApiProperty() payment?: PaymentMiniDto;
}

export class StoreSummaryDto {
  storeId!: string;
  storeName?: string;
  storeStatus!:
    | "PENDING"
    | "PACKED"
    | "SHIPPED"
    | "DELIVERED"
    | "CANCELED"
    | "RETURNED";
  itemsCount!: number;
  itemsTotal!: number;
  itemsPreview?: OrderItemPreviewDto[];
}

export class PaymentMiniDto {
  status?:
    | "requires_action"
    | "processing"
    | "succeeded"
    | "failed"
    | "canceled";
  // (ทางเลือก) provider?: "stripe"|"promptpay"|"omise";
  // (ทางเลือก) method?: "card"|"promptpay"|"cod";
}

class OrderItemPreviewDto {
  @ApiProperty() name!: string;
  @ApiProperty() qty!: number;
  @ApiProperty({ required: false }) image?: string;
  @ApiProperty({ type: Object }) attributes?: Record<string, string>;
}
