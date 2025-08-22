import { PlaceOrderDto } from "../dto/place-order.dto";

export type Args = {
  dto: PlaceOrderDto;
  userId: string;
  cartKey: string;
  idemKey?: string;
  setCookie: (k: string, v: string, maxAgeSec: number) => void;
};

export type MarkPayingInput = {
  paymentIntentId: string;
  amount?: number; // หน่วยเป็นบาท (float) ถ้าอยากเก็บเป็นสตางค์ ให้เปลี่ยนเป็น number ของสตางค์
  currency?: string; // 'thb' ฯลฯ
  provider?: string;
};

export type MarkPaidArgs = {
  paymentIntentId: string;
  chargeId?: string;
  paidAt?: Date;
  amount: number; // ที่จ่ายจริง (เช่น amount_received/100)
  currency: string; // 'thb' หรือ 'THB' แล้วแต่เก็บ
};
