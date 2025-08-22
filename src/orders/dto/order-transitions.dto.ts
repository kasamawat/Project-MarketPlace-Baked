// src/orders/dto/order-transitions.dto.ts
export type MarkFailedArgs = {
  paymentIntentId?: string;
  failureReason?: string;
  canceledAt?: Date;
};
