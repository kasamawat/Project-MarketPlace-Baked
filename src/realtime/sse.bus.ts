// sse.bus.ts
import { Injectable } from "@nestjs/common";
import { Subject, Observable } from "rxjs";

type OrderEvent = {
  masterOrderId: string;
  status:
    | "awaiting_payment"
    | "pending_payment"
    | "paying"
    | "paid"
    | "failed"
    | "canceled";
  paidAt?: string;
  paidAmount?: number;
  paidCurrency?: string;
  paymentIntentId?: string;
  chargeId?: string;
  reason?: string;
  error?: string;
  at?: string;
};

@Injectable()
export class SseBus {
  private channels = new Map<string, Subject<OrderEvent>>();

  /** สร้าง/คืน stream ของ masterOrderId */
  streamOrder(masterOrderId: string): Observable<OrderEvent> {
    if (!this.channels.has(masterOrderId))
      this.channels.set(masterOrderId, new Subject<OrderEvent>());
    return this.channels.get(masterOrderId)!.asObservable();
  }

  // เรียกจาก consumer เมื่อมี payments.succeeded/failed หรือจาก OrdersService หลัง update
  push(ev: OrderEvent) {
    this.channels.get(ev.masterOrderId)?.next(ev);
  }

  /** ปิดช่อง (ถ้าอยากทำความสะอาดหลังสถานะสุดท้าย) */
  complete(masterOrderId: string) {
    const ch = this.channels.get(masterOrderId);
    if (ch) {
      ch.complete();
      this.channels.delete(masterOrderId);
    }
  }
}
