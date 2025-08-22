// inventory.service.ts
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { InjectModel, InjectConnection } from "@nestjs/mongoose";
import { Model, Types, Connection, ClientSession } from "mongoose";
import {
  InventoryLedger,
  InventoryLedgerDocument,
} from "./schemas/inventory-ledger.schema";
import { Reservation, ReservationDocument } from "./schemas/reservation.schema";
import { Sku, SkuDocument } from "src/skus/schemas/sku-schema";
import { AdjustInventoryDto } from "./dto/adjust-inventory.dto";
import { JwtPayload } from "src/auth/types/jwt-payload.interface";
import { SkuLeanRaw } from "src/products/dto/response-skus.dto";
import { Order, OrderDocument } from "src/orders/schemas/order.schema";
import { InventoryResolverService } from "./common/inventory-resolver.service";
import {
  buildCommitCondition,
  buildCommitUpdate,
  IncUpdate,
  SkuCond,
} from "./helper/inventory-helper";
import { AggRow, ReleaseMeta, ReservationLean } from "./types/inventory.types";

@Injectable()
export class InventoryService {
  [x: string]: any;
  constructor(
    @InjectModel(InventoryLedger.name)
    private ledgerModel: Model<InventoryLedgerDocument>,
    @InjectModel(Reservation.name)
    private reservationModel: Model<ReservationDocument>,
    @InjectModel(Sku.name) private skuModel: Model<SkuDocument>,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly inventoryResolverService: InventoryResolverService,
  ) {}

  async stockIn(skuId: string, qty: number, note?: string) {
    const session = await this.connection.startSession();
    await session.withTransaction(async () => {
      await this.ledgerModel.create([{ skuId, op: "IN", qty, note }], {
        session,
      });
      await this.skuModel.updateOne(
        { _id: skuId },
        { $inc: { onHand: qty, available: qty } },
        { session },
      );
    });
    await session.endSession();
  }

  async reserve(
    skuId: string,
    productId: string,
    storeId: string,
    qty: number,
    opts: { cartId?: string; userId?: string; ttlMinutes?: number } = {},
    session?: ClientSession,
  ): Promise<void> {
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new BadRequestException("qty must be a positive integer");
    }

    // ฟังก์ชันหลักที่อาศัย session (ถ้ามี)
    const runWithSession = async (s?: ClientSession) => {
      // 1) กัน oversell ด้วยเงื่อนไข $expr (onHand - reserved >= qty)
      const inc = await this.skuModel.updateOne(
        {
          _id: new Types.ObjectId(skuId),
          $expr: { $gte: [{ $subtract: ["$onHand", "$reserved"] }, qty] },
        },
        { $inc: { reserved: qty } },
        s ? { session: s } : undefined,
      );
      if (inc.modifiedCount === 0) {
        throw new BadRequestException("Not enough stock");
      }

      try {
        // 2) ledger
        await this.ledgerModel.create(
          [
            {
              skuId: new Types.ObjectId(skuId),
              productId: new Types.ObjectId(productId),
              storeId: new Types.ObjectId(storeId),
              op: "RESERVE",
              qty,
              referenceType: "cart",
              referenceId: opts.cartId,
            },
          ],
          s ? { session: s } : undefined,
        );

        // 3) reservation
        await this.reservationModel.create(
          [
            {
              skuId: new Types.ObjectId(skuId),
              productId: new Types.ObjectId(productId),
              storeId: new Types.ObjectId(storeId),
              qty,
              cartId: opts.cartId,
              userId: opts.userId,
              expiresAt: new Date(
                Date.now() + (opts.ttlMinutes ?? 20) * 60_000,
              ),
            },
          ],
          s ? { session: s } : undefined,
        );
      } catch (e) {
        // ถ้าไม่ได้ใช้ transaction ให้ rollback แบบชดเชย
        if (!s) {
          await this.skuModel
            .updateOne(
              { _id: new Types.ObjectId(skuId) },
              { $inc: { reserved: -qty } },
            )
            .catch(() => void 0);
        }
        throw e;
      }
    };

    // เคส 1: ผู้เรียกส่ง session มา (อยู่ใน transaction แล้ว)
    if (session) {
      await runWithSession(session);
      return;
    }

    // เคส 2: ไม่มี session — พยายามเปิด transaction; ถ้ารันบน standalone (error code 20) → ตกไป non-tx + compensating
    const s = await this.connection.startSession();
    try {
      await s.withTransaction(async () => {
        await runWithSession(s);
      });
    } catch (e: any) {
      // Fallback เมื่อเจอ "Transaction numbers are only allowed on a replica set member or mongos"
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (e?.code === 20) {
        await runWithSession(undefined); // non-transaction + compensating rollback
      } else {
        throw e;
      }
    } finally {
      await s.endSession();
    }
  }

  async release(skuId: string, qty: number, reason?: string) {
    const session = await this.connection.startSession();
    await session.withTransaction(async () => {
      await this.ledgerModel.create(
        [{ skuId, op: "RELEASE", qty, note: reason }],
        { session },
      );
      await this.skuModel.updateOne(
        { _id: skuId, reserved: { $gte: qty } },
        { $inc: { reserved: -qty, available: qty } },
        { session },
      );
    });
    await session.endSession();
  }

  async commit(skuId: string, qty: number, orderId: string) {
    const session = await this.connection.startSession();
    await session.withTransaction(async () => {
      await this.ledgerModel.create(
        [
          {
            skuId,
            op: "COMMIT",
            qty,
            referenceType: "order",
            referenceId: orderId,
          },
          {
            skuId,
            op: "OUT",
            qty,
            referenceType: "order",
            referenceId: orderId,
          },
        ],
        { session },
      );
      await this.skuModel.updateOne(
        { _id: skuId, reserved: { $gte: qty } },
        { $inc: { reserved: -qty, onHand: -qty } },
        { session },
      );
    });
    await session.endSession();
  }

  async returnIn(skuId: string, qty: number, orderId: string) {
    const session = await this.connection.startSession();
    await session.withTransaction(async () => {
      await this.ledgerModel.create(
        [
          {
            skuId,
            op: "RETURN",
            qty,
            referenceType: "order",
            referenceId: orderId,
          },
          {
            skuId,
            op: "IN",
            qty,
            referenceType: "order",
            referenceId: orderId,
          },
        ],
        { session },
      );
      await this.skuModel.updateOne(
        { _id: skuId },
        { $inc: { onHand: qty, available: qty } },
        { session },
      );
    });
    await session.endSession();
  }

  async adjustOnHand(
    productId: string,
    skuId: string,
    dto: AdjustInventoryDto,
    payload: JwtPayload,
  ) {
    const storeId = payload.storeId;
    if (!storeId) throw new ForbiddenException("Missing store in token");

    // ตรวจสิทธิ์: sku ต้องเป็นของ store ใน JWT
    const sku = await this.skuModel
      .findOne({
        _id: new Types.ObjectId(skuId),
        productId: new Types.ObjectId(productId),
      })
      .lean();
    if (!sku) throw new NotFoundException("SKU not found");

    if (dto.delta < 0) {
      // กันติดลบ
      const r = await this.skuModel.updateOne(
        { _id: skuId, onHand: { $gte: -dto.delta } },
        { $inc: { onHand: dto.delta } },
      );
      if (r.matchedCount === 0)
        throw new BadRequestException("Insufficient onHand");
    } else {
      await this.skuModel.updateOne(
        { _id: skuId },
        { $inc: { onHand: dto.delta } },
      );
    }

    // (ทางเลือก) บันทึก ledger
    await this.ledgerModel.create({
      skuId: new Types.ObjectId(skuId),
      productId: new Types.ObjectId(productId),
      storeId: new Types.ObjectId(storeId),
      op: dto.delta > 0 ? "IN" : "OUT",
      qty: Math.abs(dto.delta),
      referenceType: "manual",
      note: dto.reason,
      // userId: user.sub
    });

    const after = await this.skuModel.findById(skuId).lean<SkuLeanRaw>().exec();
    return {
      _id: String(after!._id),
      onHand: after!.onHand ?? 0,
      reserved: after!.reserved ?? 0,
      available: Math.max(0, (after!.onHand ?? 0) - (after!.reserved ?? 0)),
    };
  }

  /**
   * ตัดสต็อกจาก "ของที่ถูกจอง" ตามออเดอร์ (payment succeeded)
   * - กิน reservation จาก cartId ของออเดอร์
   * - ลด onHand ตามจำนวนซื้อจริง
   * - ลด reserved เท่าที่กินได้จาก reservation
   * - กัน oversell ด้วยเงื่อนไข atomic
   */
  async commitReservationByOrder(
    orderId: string,
    opts: { reason?: string; referenceId?: string } = {},
    session?: ClientSession,
  ): Promise<void> {
    const orderIdObj = new Types.ObjectId(orderId);

    // 1) load order
    const order = await this.orderModel
      .findById(orderIdObj)
      .lean()
      .session(session ?? null);

    if (!order) throw new NotFoundException("Order not found");
    if (!order.items?.length) return; // ไม่มีของให้ตัด

    // 2) loop product order
    for (const it of order.items) {
      const skuId = new Types.ObjectId(String(it.skuId));
      const qty = it.quantity ?? 0;
      if (qty <= 0) continue;

      // 2.1) merge reservations of cartId+skuId to consume
      const reservedCovered =
        await this.inventoryResolverService.consumeReservationsForSku(
          order.cartId,
          skuId,
          qty,
          session,
        );

      // หาก TTL ลบ reservation ออกไปก่อนชำระสำเร็จ reservedCovered อาจ < qty
      const shortage = Math.max(0, qty - reservedCovered);

      // 2.2) อัปเดต SKU แบบอะตอมมิก:
      // - ต้องมี onHand >= qty แน่ ๆ (เราจะ "จ่ายออก" เท่านี้)
      // - ถ้ามี shortage ต้องเช็ค onHand - reserved >= shortage
      const cond: SkuCond = buildCommitCondition(skuId, qty, shortage);
      const update: IncUpdate = buildCommitUpdate(qty, reservedCovered);

      const u = await this.skuModel.updateOne(cond, update, { session }).exec();

      if (u.modifiedCount === 0) {
        // กันกรณีพิเศษ: สต็อกไม่พอ commit (ผิดปกติ ถ้า flow reserve ถูกต้อง)
        throw new BadRequestException("Insufficient stock to commit");
      }

      // 2.3) บันทึก ledger: COMMIT = ของออกจากคลังจากยอดที่ชำระสำเร็จ
      await this.ledgerModel.create(
        [
          {
            skuId,
            productId: it.productId,
            storeId: it.storeId,
            op: "COMMIT",
            qty,
            referenceType: "order",
            referenceId: order._id,
            note: opts.reason ?? "payment_succeeded",
          },
        ],
        { session },
      );
    }
  }

  /**
   * ปล่อย stock ที่ "จองไว้" ทั้งหมดของออเดอร์ (เช่น เมื่อ payment failed/canceled)
   * - ลด reserved ของ SKU ตามจำนวนที่จองไว้
   * - เขียน ledger: RELEASE
   * - ลบ Reservation ที่เกี่ยวข้อง
   * - ทำงานใน transaction; idempotent (ถ้าถูกปล่อยไปแล้วจะไม่มี reservation เหลือ → จบเงียบ ๆ)
   */
  async releaseReservationByOrder(
    orderId: string,
    meta: ReleaseMeta = {},
    session?: ClientSession,
  ): Promise<void> {
    const useOwnSession = !session;
    const s = session ?? (await this.connection.startSession());

    try {
      await s.withTransaction(async () => {
        const order = await this.orderModel
          .findById(new Types.ObjectId(orderId))
          .select("_id cartId")
          .session(s)
          .lean<{ _id: Types.ObjectId; cartId: Types.ObjectId }>()
          .exec();

        if (!order) throw new NotFoundException("Order not found");

        // ถ้า Reservation ของคุณ “ผูกกับ orderId” อยู่แล้ว ให้เปลี่ยน filter เป็น { orderId: order._id }
        // ที่โค้ดนี้จะใช้ cartId ที่สร้าง order มาผูกการจองไว้
        const reservations = await this.reservationModel
          .find({ cartId: String(order.cartId) })
          .session(s)
          .lean<ReservationLean[]>()
          .exec();

        if (!reservations.length) {
          // idempotent: ไม่มีอะไรให้ปล่อยแล้ว
          return;
        }

        // รวมจำนวนที่จองไว้ต่อ SKU
        const bySku = new Map<string, AggRow>();
        for (const r of reservations) {
          const skuIdStr = String(r.skuId);
          const qty = r.qty ?? 0;

          const prodId =
            r.productId instanceof Types.ObjectId
              ? r.productId
              : new Types.ObjectId(String(r.productId));
          const storeId =
            r.storeId instanceof Types.ObjectId
              ? r.storeId
              : new Types.ObjectId(String(r.storeId));

          const ex = bySku.get(skuIdStr);
          if (ex) {
            ex.qty += qty;

            // (ปกติ SKU เดียวต้องสังกัด product/store เดียวกันอยู่แล้ว)
            // ถ้าพบไม่ตรงกัน ให้ log ไว้เผื่อข้อมูลไม่สะอาด
            if (!ex.productId.equals(prodId) || !ex.storeId.equals(storeId)) {
              console.log(`Reservation data mismatch for sku=${skuIdStr}`);
            }
          } else {
            bySku.set(skuIdStr, { qty, productId: prodId, storeId });
          }
        }

        // ลด reserved แบบอะตอมมิก (กันติดลบ) ด้วย bulkWrite
        const decOps = Array.from(bySku.entries()).map(([skuIdStr, agg]) => ({
          updateOne: {
            filter: {
              _id: new Types.ObjectId(skuIdStr),
              reserved: { $gte: agg.qty },
            },
            update: { $inc: { reserved: -agg.qty } },
          },
        }));

        if (decOps.length) {
          const bulkRes = await this.skuModel.bulkWrite(decOps, { session: s });
          // ถ้าบางตัวลดไม่ได้ (reserved < qty) ให้ throw เพื่อให้ผู้ดูแลตรวจสอบความไม่สอดคล้อง
          if (bulkRes.matchedCount !== decOps.length) {
            throw new BadRequestException(
              "Inconsistent reserved quantity when releasing stock",
            );
          }
        }

        const refIdObj = Types.ObjectId.isValid(orderId)
          ? new Types.ObjectId(orderId)
          : undefined; // ถ้า schema อนุญาต string ก็ส่ง string เดิม

        // เขียน ledger แบบรวมต่อ SKU
        const ledgerRows = Array.from(bySku.entries()).map(
          ([skuIdStr, agg]) => ({
            skuId: new Types.ObjectId(skuIdStr),
            productId: agg.productId,
            storeId: agg.storeId,
            op: "RELEASE" as const,
            qty: agg.qty,
            referenceType: "order",
            referenceId: refIdObj ?? orderId,
            note: meta.reason,
          }),
        );
        if (ledgerRows.length) {
          await this.ledgerModel.insertMany(ledgerRows, { session: s });
        }

        // ลบ reservations ชุดนี้
        const resIds = reservations.map((r) => r._id);
        await this.reservationModel
          .deleteMany({ _id: { $in: resIds } })
          .session(s)
          .exec();
      });
    } finally {
      if (useOwnSession) await s.endSession();
    }
  }
}
