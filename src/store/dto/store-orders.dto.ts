export class StoreOrdersDto {
  page?: number | string;
  limit?: number | string;
  payStatus?: string; // e.g. "paid" | "pending_payment" | "canceled" | "expired" | "all"
  fulfillStatus?: string; // e.g. "PENDING,PACKED" | "UNFULFILLED" | "SHIPPED" | "all"
}
