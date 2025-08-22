// payments/types.ts
export type PaymentMethodKind = "general" | "promptpay";

export type CreateIntentArgs = {
  orderId: string; // ไอดีออเดอร์ของคุณ ใช้ผูก metadata + idempotency
  amount: number; // จำนวนเงินหน่วยบาท (เช่น 199.5)
  customerEmail?: string; // สำหรับส่งใบเสร็จ/receipt
  method: PaymentMethodKind;
  idempotencyKey?: string; // (optional) ถ้าอยากกำหนดเอง
};

export type CreateIntentResult = {
  intentId: string;
  clientSecret: string; // การันตีว่าเป็น string (ไม่ปล่อย null ออกไป)
  paymentUrl?: string; // สำหรับ PromptPay หรือวิธีจ่ายที่มี URL
};
