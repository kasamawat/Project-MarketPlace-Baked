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

/** ใหม่: สำหรับ in-app notification ต่อผู้ใช้ */
export type NotiEvent = {
  /** ชนิดแจ้งเตือน เช่น ORDER_CREATED / ORDER_PAID / ORDER_SHIPPED / ORDER_DELIVERED */
  type: string;
  /** เอกสาร notification ทั้งก้อน หรือ payload ที่ FE ต้องใช้ */
  payload: any;
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

  // ---- ใหม่: stream ต่อ user (notifications) ----
  private userChannels = new Map<string, Subject<NotiEvent>>();

  /** stream ของผู้ใช้ (ใช้ใน SSE /realtime/notifications/stream) */
  streamUser(userId: string): Observable<NotiEvent> {
    if (!this.userChannels.has(userId))
      this.userChannels.set(userId, new Subject<NotiEvent>());
    return this.userChannels.get(userId)!.asObservable();
  }

  /** push แจ้งเตือนให้ผู้ใช้คนหนึ่ง */
  pushToUser(userId: string, event: NotiEvent) {
    this.userChannels.get(userId)?.next(event);
  }

  /** ปิดช่องของผู้ใช้ (ถ้าต้องการ cleanup เมื่อ logout/disconnect) */
  completeUser(userId: string) {
    const ch = this.userChannels.get(userId);
    if (ch) {
      ch.complete();
      this.userChannels.delete(userId);
    }
  }
}
