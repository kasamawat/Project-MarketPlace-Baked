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
  masterOrderId: string;
  paymentIntentId: string;
  at?: string;
};

export type PaymentsSucceededPayload = {
  masterOrderId: string;
  paymentIntentId: string;
  chargeId?: string;
  paidAmount?: number; // อาจไม่มี ถ้าไม่ใส่ตอน publish
  paidCurrency?: string; // อาจไม่มี
  at?: string;
};

export type PaymentsCanceledPayload = {
  masterOrderId: string;
  paymentIntentId: string;
  reason?: string;
};

export type PaymentsFailedPayload = {
  masterOrderId: string;
  paymentIntentId: string;
  error?: string;
  at?: string;
};
