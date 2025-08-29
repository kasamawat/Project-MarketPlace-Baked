import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { ClientSession, Model, Types } from "mongoose";
import {
  Reservation,
  ReservationDocument,
} from "../schemas/reservation.schema";

const PURGE_DAYS_AFTER_CONSUMED = 30;

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

@Injectable()
export class InventoryResolverService {
  constructor(
    @InjectModel(Reservation.name)
    private reservationModel: Model<ReservationDocument>,
  ) {}

  /**
   * ✅ ใช้ตอน commit โดยอ้าง masterOrderId ก่อน (flow ใหม่)
   * - กิน (consume) จาก reservation ที่ status=ACTIVE ของ masterOrderId + skuId
   * - เรียงหมดอายุก่อน (expiresAt ASC) แล้วค่อย createdAt ASC
   * - ถ้ากินหมดทั้งเอกสาร → set status=CONSUMED, consumedAt, purgeAfter
   * - ถ้ากินบางส่วน → ลด qty ของเอกสารเดิม แล้ว "clone" เอกสารใหม่สถานะ CONSUMED ไว้เป็น audit
   * - คืนจำนวนที่ครอบคลุมได้จริง
   */
  async consumeReservationsForSkuByMaster(
    masterOrderId: Types.ObjectId,
    skuId: Types.ObjectId,
    needQty: number,
    session?: ClientSession,
  ): Promise<number> {
    if (!needQty || needQty <= 0) return 0;

    const now = new Date();

    const curs = await this.reservationModel
      .find({
        masterOrderId,
        skuId,
        status: "ACTIVE",
      })
      .sort({ expiresAt: 1, createdAt: 1 })
      .session(session ?? null)
      .lean()
      .exec();

    let remain = needQty;

    for (const r of curs) {
      if (remain <= 0) break;

      const take = Math.min(remain, r.qty);
      const left = r.qty - take;

      if (left > 0) {
        // 1) partial consume → ลด qty ของตัวเดิม
        await this.reservationModel
          .updateOne(
            { _id: r._id, status: "ACTIVE" },
            { $inc: { qty: -take }, $set: { updatedAt: now } },
            { session },
          )
          .exec();

        // 2) บันทึก consumption แยกเป็นเอกสาร CONSUMED (audit)
        const consumedDoc: Partial<Reservation> = {
          skuId: r.skuId,
          productId: r.productId,
          storeId: r.storeId,
          qty: take,
          expiresAt: r.expiresAt, // เก็บไว้เพื่ออ้างอิง
          cartId: r.cartId,
          userId: r.userId,
          masterOrderId: r.masterOrderId,
          storeOrderId: r.storeOrderId, // ถ้าไม่ได้ใช้ ลบทิ้งได้
          status: "CONSUMED" as const,
          consumedAt: now,
          purgeAfter: addDays(now, PURGE_DAYS_AFTER_CONSUMED),
        };

        await this.reservationModel.create([consumedDoc], { session });
      } else {
        // กินหมดทั้งเอกสาร → mark CONSUMED
        await this.reservationModel
          .updateOne(
            { _id: r._id, status: "ACTIVE" },
            {
              $set: {
                status: "CONSUMED",
                consumedAt: now,
                purgeAfter: addDays(now, PURGE_DAYS_AFTER_CONSUMED),
                updatedAt: now,
              },
            },
            { session },
          )
          .exec();
      }

      remain -= take;
    }

    return needQty - remain;
  }

  /**
   * (อัปเกรดจากของเดิม) ใช้ cartId (fallback)
   * - เปลี่ยนจาก delete เอกสาร → มาใช้แนวทาง CONSUMED + clone ส่วนที่กินบางส่วน
   * - ยังคง behavior: เรียงตาม createdAt (หรือจะใช้ expiresAt ก่อนเหมือนด้านบนก็ได้)
   */
  async consumeReservationsForSku(
    cartId: Types.ObjectId,
    skuId: Types.ObjectId,
    needQty: number,
    session?: ClientSession,
  ): Promise<number> {
    if (!needQty || needQty <= 0) return 0;

    const now = new Date();

    const curs = await this.reservationModel
      .find({ cartId, skuId, status: "ACTIVE" })
      .sort({ expiresAt: 1, createdAt: 1 })
      .session(session ?? null)
      .exec();

    let remain = needQty;

    for (const r of curs) {
      if (remain <= 0) break;

      const take = Math.min(remain, r.qty);
      const left = r.qty - take;

      if (left > 0) {
        // partial: ลด qty ของเอกสารเดิม
        await this.reservationModel
          .updateOne(
            { _id: r._id, status: "ACTIVE" },
            { $inc: { qty: -take }, $set: { updatedAt: now } },
            { session },
          )
          .exec();

        // สร้างเอกสาร CONSUMED แยก
        await this.reservationModel.create(
          [
            {
              skuId: r.skuId,
              productId: r.productId,
              storeId: r.storeId,
              qty: take,
              expiresAt: r.expiresAt,
              cartId: r.cartId,
              userId: r.userId,
              masterOrderId: r.masterOrderId, // เผื่อมีอัปเดตเพิ่ม
              status: "CONSUMED",
              consumedAt: now,
              purgeAfter: addDays(now, PURGE_DAYS_AFTER_CONSUMED),
            } as Partial<Reservation>,
          ],
          { session },
        );
      } else {
        // consume ทั้งก้อน
        await this.reservationModel
          .updateOne(
            { _id: r._id, status: "ACTIVE" },
            {
              $set: {
                status: "CONSUMED",
                consumedAt: now,
                purgeAfter: addDays(now, PURGE_DAYS_AFTER_CONSUMED),
                updatedAt: now,
              },
            },
            { session },
          )
          .exec();
      }

      remain -= take;
    }

    return needQty - remain;
  }
}
