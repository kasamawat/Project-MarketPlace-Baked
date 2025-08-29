export type PaymentEventRow = { id: string; type: string; createdAt: Date };

export type PendingEvent = {
  exchange: string;
  routingKey: string;
  payload: Record<string, any>;
  // messageId: string;
  options: { messageId?: string; persistent?: boolean };
};
