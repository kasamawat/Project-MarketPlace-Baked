// sse.bus.ts
import { Injectable } from "@nestjs/common";
import { Subject, Observable } from "rxjs";

type OrderEvent = {
  orderId: string;
  status: "awaiting_payment" | "paying" | "paid" | "failed" | "canceled";
  paidAt?: string;
  paidAmount?: number;
  paidCurrency?: string;
  paymentIntentId?: string;
  chargeId?: string;
};

@Injectable()
export class SseBus {
  private channels = new Map<string, Subject<OrderEvent>>();

  /** สร้าง/คืน stream ของ orderId */
  streamOrder(orderId: string): Observable<OrderEvent> {
    if (!this.channels.has(orderId))
      this.channels.set(orderId, new Subject<OrderEvent>());
    return this.channels.get(orderId)!.asObservable();
  }

  // เรียกจาก consumer เมื่อมี payments.succeeded/failed หรือจาก OrdersService หลัง update
  push(ev: OrderEvent) {
    this.channels.get(ev.orderId)?.next(ev);
  }

  /** ปิดช่อง (ถ้าอยากทำความสะอาดหลังสถานะสุดท้าย) */
  close(orderId: string) {
    const ch = this.channels.get(orderId);
    if (ch) {
      ch.complete();
      this.channels.delete(orderId);
    }
  }
}
