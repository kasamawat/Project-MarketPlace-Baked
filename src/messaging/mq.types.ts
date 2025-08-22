export interface MqPublisher {
  publishTopic(
    exchange: string,
    routingKey: string,
    payload: Record<string, any>,
    opts?: {
      headers?: Record<string, any>;
      persistent?: boolean;
      messageId?: string;
    },
  ): Promise<void>;
}

export type PaymentsProcessingPayload = {
  orderId: string;
  paymentIntentId: string;
  at?: string;
};

export type PaymentsSucceededPayload = {
  orderId: string;
  paymentIntentId: string;
  chargeId?: string;
  paidAmount?: number; // อาจไม่มี ถ้าไม่ใส่ตอน publish
  paidCurrency?: string; // อาจไม่มี
  at?: string;
};

export type PaymentsFailedPayload = {
  orderId: string;
  paymentIntentId: string;
  error?: string;
  at?: string;
};
