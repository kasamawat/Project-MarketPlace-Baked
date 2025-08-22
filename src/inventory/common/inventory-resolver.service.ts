import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { ClientSession, Model, Types } from "mongoose";

import {
  Reservation,
  ReservationDocument,
} from "../schemas/reservation.schema";

@Injectable()
export class InventoryResolverService {
  constructor(
    @InjectModel(Reservation.name)
    private reservationModel: Model<ReservationDocument>,
  ) {}

  async consumeReservationsForSku(
    cartId: Types.ObjectId,
    skuId: Types.ObjectId,
    needQty: number,
    session?: ClientSession,
  ): Promise<number> {
    if (!needQty) return 0;

    // ดึงเฉพาะของ SKU นี้ที่มาจาก cartId เดียวกัน (ก่อน place order เรา reserve ด้วย cartId)
    const curs = await this.reservationModel
      .find({ cartId: String(cartId), skuId })
      .sort({ createdAt: 1 })
      .session(session ?? null)
      .exec();

    let remain = needQty;
    for (const r of curs) {
      if (remain <= 0) break;
      const take = Math.min(remain, r.qty);
      const left = r.qty - take;

      if (left > 0) {
        // ลดปริมาณในเอกสารเดิม
        await this.reservationModel
          .updateOne({ _id: r._id }, { $set: { qty: left } }, { session })
          .exec();
      } else {
        // กินหมด -> ลบทิ้ง
        await this.reservationModel
          .deleteOne({ _id: r._id }, { session })
          .exec();
      }

      remain -= take;
    }

    return needQty - remain;
  }
}
