// src/orders/dto/checkout-response.dto.ts
export type CheckoutResponseDto = {
  orderId: string;
  amount: number;
  customerEmail?: string;
  clientSecret: string; // <- ใช้ render PaymentElement
};
