export type PaymentEventRow = { id: string; type: string; createdAt: Date };

export type PendingEvent = {
  routingKey: "payments.processing" | "payments.succeeded" | "payments.failed";
  payload: Record<string, any>;
  messageId: string;
};
