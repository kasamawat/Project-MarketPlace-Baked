// src/orders/dto/buyer-order-list.dto.ts
import { ApiProperty } from "@nestjs/swagger";
import { MasterStatus, StoreStatus } from "../schemas/shared.subdocs";

export class BuyerListItemDto {
  @ApiProperty() masterOrderId!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty() itemsCount!: number;
  @ApiProperty() itemsTotal!: number;
  @ApiProperty() currency!: string;
  @ApiProperty({
    enum: ["pending_payment", "paid", "expired", "canceled", "refunded"],
  })
  buyerStatus!: MasterStatus;
  @ApiProperty({ required: false }) reservationExpiresAt?: string;
  @ApiProperty() storesSummary?: StoreSummaryDto[];
  @ApiProperty() payment?: PaymentMiniDto;
}

export class StoreSummaryDto {
  storeId!: string;
  storeName?: string;
  buyerStatus!: MasterStatus;
  storeStatus!: StoreStatus;
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
  @ApiProperty() cover: ImageItemDto;
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
