// inventory.service.ts
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { InjectModel, InjectConnection } from "@nestjs/mongoose";
import { Model, Types, Connection, ClientSession, FilterQuery } from "mongoose";
import {
  InventoryLedger,
  InventoryLedgerDocument,
} from "./schemas/inventory-ledger.schema";
import { Reservation, ReservationDocument } from "./schemas/reservation.schema";
import { Sku, SkuDocument } from "src/skus/schemas/sku-schema";
import { AdjustInventoryDto } from "./dto/adjust-inventory.dto";
import { JwtPayload } from "src/auth/types/jwt-payload.interface";
import { SkuLeanRaw } from "src/products/dto/response-skus.dto";
import { InventoryResolverService } from "./common/inventory-resolver.service";
import {
  buildCommitCondition,
  buildCommitUpdate,
} from "./helper/inventory-helper";
import { ReservationLean } from "./types/inventory.types";
import {
  MasterOrder,
  MasterOrderDocument,
} from "src/orders/schemas/master-order.schema";
import {
  StoreOrder,
  StoreOrderDocument,
} from "src/orders/schemas/store-order.schema";
import { StoreOrderItemLean } from "./helper/store-order-items-lean";

@Injectable()
export class InventoryService {
  constructor(
    @InjectConnection() private readonly conn: Connection,
    @InjectModel(InventoryLedger.name)
    private ledgerModel: Model<InventoryLedgerDocument>,
    @InjectModel(Reservation.name)
    private reservationModel: Model<ReservationDocument>,
    @InjectModel(Sku.name) private skuModel: Model<SkuDocument>,
    @InjectModel(StoreOrder.name)
    private readonly storeOrderModel: Model<StoreOrderDocument>,
    @InjectModel(MasterOrder.name)
    private readonly masterOrderModel: Model<MasterOrderDocument>,
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
    masterOrderId: string,
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
        // 2) ledger create RESERVE status
        await this.ledgerModel.create(
          [
            {
              skuId: new Types.ObjectId(skuId),
              productId: new Types.ObjectId(productId),
              storeId: new Types.ObjectId(storeId),
              masterOrderId: new Types.ObjectId(masterOrderId),
              op: "RESERVE",
              qty,
              referenceType: "cart",
              referenceId: new Types.ObjectId(opts.cartId),
            },
          ],
          s ? { session: s } : undefined,
        );

        // 3) create reservation
        const ttlMinutes = opts.ttlMinutes ?? 20;
        const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

        // TTL safety-net: ลบจริงหลังจากหมดสิทธิ์ถือจองไปอีก 6 ชม.
        const PURGE_BUFFER_MS = 6 * 60 * 60 * 1000;
        const purgeAfter = new Date(expiresAt.getTime() + PURGE_BUFFER_MS);

        // แปลงเฉพาะเมื่อมีค่า (guest/anon อาจไม่มี userId)
        const cartIdObj = opts.cartId
          ? new Types.ObjectId(opts.cartId)
          : undefined;
        const userIdObj = opts.userId
          ? new Types.ObjectId(opts.userId)
          : undefined;

        await this.reservationModel.create(
          [
            {
              skuId: new Types.ObjectId(skuId),
              productId: new Types.ObjectId(productId),
              storeId: new Types.ObjectId(storeId),
              masterOrderId: new Types.ObjectId(masterOrderId),
              qty,
              cartId: cartIdObj,
              userId: userIdObj,
              expiresAt,
              purgeAfter,
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
            referenceId: new Types.ObjectId(orderId),
          },
          {
            skuId,
            op: "OUT",
            qty,
            referenceType: "order",
            referenceId: new Types.ObjectId(orderId),
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
            referenceId: new Types.ObjectId(orderId),
          },
          {
            skuId,
            op: "IN",
            qty,
            referenceType: "order",
            referenceId: new Types.ObjectId(orderId),
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
  async commitReservationByMaster(
    masterOrderId: string,
    opts: { reason?: string; referenceId?: string } = {},
    session?: ClientSession,
  ): Promise<void> {
    const _id = new Types.ObjectId(masterOrderId);

    // 1) โหลด MasterOrder (ต้องมี เพื่อหา cartId เป็น fallback)
    const master = await this.masterOrderModel
      .findById(_id)
      .select({ _id: 1, cartId: 1 })
      .lean()
      .session(session ?? null);

    if (!master) throw new NotFoundException("Master order not found");

    // 2) โหลด StoreOrders + Items ของ master นี้ทั้งหมด (โหมด lean ให้วิ่งไว)
    const storeOrders = await this.storeOrderModel
      .find({ masterOrderId: _id })
      .select({ items: 1 })
      .lean()
      .session(session ?? null);

    if (!storeOrders?.length) return; // ไม่มีของให้ตัด

    // 3) loop ทุกรายการสินค้าในทุก StoreOrder
    for (const so of storeOrders) {
      const items: StoreOrderItemLean[] = so.items ?? [];

      for (const it of items) {
        const skuId = new Types.ObjectId(String(it.skuId));
        const qty = Number(it.quantity ?? 0);
        if (qty <= 0) continue;

        // 3.1) พยายาม consume reservation ด้วย masterOrderId ก่อน
        let reservedCovered = 0;

        if (this.inventoryResolverService?.consumeReservationsForSkuByMaster) {
          reservedCovered =
            await this.inventoryResolverService.consumeReservationsForSkuByMaster(
              _id,
              skuId,
              qty,
              session,
            );
        } else {
          // ถ้าไม่มี method จำเพาะ master ให้ใช้ตัวเดิม (cartId) เป็นหลัก แล้วคุณสามารถเพิ่มเวอร์ชัน by master ภายหลัง
          // (หรือจะโยน error เพื่อตามแก้ให้ครบก็ได้)
          reservedCovered = 0;
        }

        // 3.1.1) ถ้า covered ยังไม่ครบ และ master มี cartId → fallback ไปคิวรีจาก cartId
        if (reservedCovered < qty && master.cartId) {
          const more =
            await this.inventoryResolverService.consumeReservationsForSku(
              master.cartId,
              skuId,
              qty - reservedCovered,
              session,
            );
          reservedCovered += more;
        }

        // 3.2) หาก TTL ลบ reservation ไปก่อน → reservedCovered อาจ < qty
        const shortage = Math.max(0, qty - reservedCovered);

        // 3.3) อัปเดต SKU แบบอะตอมมิก:
        // - ต้องมั่นใจว่า onHand >= qty (ของที่ต้องจ่ายออก)
        // - ถ้ามี shortage ต้องเช็ค available (หรือ onHand-reserved) >= shortage
        const cond = buildCommitCondition(skuId, qty, shortage);
        const update = buildCommitUpdate(qty, reservedCovered);

        const u = await this.skuModel
          .updateOne(cond, update, { session })
          .exec();
        if (u.modifiedCount === 0) {
          // กันกรณีพิเศษ: สต็อกไม่พอ commit (ถ้า flow reserve ถูกต้องไม่ควรเกิด)
          throw new BadRequestException("Insufficient stock to commit");
        }

        // 3.4) บันทึก ledger: COMMIT = ของออกจากคลังจากยอดที่ชำระสำเร็จ
        await this.ledgerModel.create(
          [
            {
              skuId,
              productId: new Types.ObjectId(String(it.productId)),
              storeId: new Types.ObjectId(String(it.storeId)),
              op: "COMMIT",
              qty,
              referenceType: "master_order", // ✅ เปลี่ยน ref ให้สอดคล้อง
              referenceId: _id,
              note: opts.reason ?? "payment_succeeded",
              referenceExt: opts.referenceId, // เก็บ PI/chargeId เพิ่มได้
              at: new Date(),
            },
          ],
          { session },
        );
      }
    }
  }

  /**
   * ปล่อย (release) reservation ทั้งหมดที่ผูกกับ masterOrderId
   * - ถ้ามี reservation ที่ยัง ACTIVE → ลด reserved และเพิ่ม available กลับ
   * - mark reservation = RELEASED (idempotent: เรียกซ้ำไม่พัง)
   * - รองรับกรณี reserve เก่าที่ไม่มี masterOrderId → fallback จาก cartId ใน Master
   */
  async releaseByMaster(
    masterOrderId: string,
    session?: ClientSession,
  ): Promise<void> {
    const _id = new Types.ObjectId(masterOrderId);

    // 1) หาว่ามี reservation ผูกกับ master โดยตรงไหม
    const directQuery: FilterQuery<Reservation> = {
      masterOrderId: _id,
      status: "ACTIVE",
    };

    // 2) ถ้าไม่มี ให้ fallback ไป cartId ของ master
    let hasAny = await this.reservationModel
      .exists(directQuery)
      .session(session ?? null);
    let query: FilterQuery<Reservation> = directQuery;

    if (!hasAny) {
      const master = await this.masterOrderModel
        .findById(_id)
        .select({ cartId: 1 })
        .lean()
        .session(session ?? null);
      if (master?.cartId) {
        query = { cartId: master.cartId, status: "ACTIVE" };
        hasAny = await this.reservationModel
          .exists(query)
          .session(session ?? null);
      }
    }

    if (!hasAny) return; // ไม่มีอะไรต้องปล่อย → จบแบบ idempotent

    // 3) ดึงรายการที่จะปล่อย (เฉพาะ ACTIVE)
    const reservations = await this.reservationModel
      .find(query)
      .select({ _id: 1, skuId: 1, storeId: 1, qty: 1 })
      .lean<ReservationLean[]>()
      .session(session ?? null);

    if (reservations.length === 0) return;

    // 4) รวม qty ต่อ skuId (ไม่ใช้ storeId เพราะ skus ไม่มีฟิลด์นี้)
    const aggregateMap = new Map<
      string,
      { skuId: Types.ObjectId; qty: number }
    >();
    for (const r of reservations) {
      const key = String(r.skuId);
      if (!aggregateMap.has(key)) {
        aggregateMap.set(key, { skuId: r.skuId, qty: 0 });
      }
      aggregateMap.get(key)!.qty += r.qty;
    }

    // 5) ทำงานใน transaction (หรือใช้ session ที่ถูกส่งมา)
    const localSession = session ?? (await this.conn.startSession());
    const shouldEnd = !session;

    try {
      if (!session) localSession.startTransaction();

      // 5.1 อัปเดต stock: reserved -= qty, available += qty
      const now = new Date();
      const stockOps = Array.from(aggregateMap.values()).map((g) => ({
        updateOne: {
          filter: { _id: g.skuId },
          update: {
            $inc: { reserved: -g.qty, available: +g.qty },
            $set: { updatedAt: new Date() },
          },
          upsert: false, // เผื่อกรณี stock ยังไม่มีเอกสาร (rare)
        },
      }));
      if (stockOps.length) {
        await this.skuModel.bulkWrite(stockOps, { session: localSession });
      }

      // 5.2 mark reservation = RELEASED (เฉพาะ ACTIVE) + ตั้ง purgeAfter
      await this.reservationModel.updateMany(
        { _id: { $in: reservations.map((r) => r._id) }, status: "ACTIVE" },
        {
          $set: {
            status: "RELEASED",
            releasedAt: now,
            releasedReason: "payment_timeout",
            purgeAfter: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
            updatedAt: now,
          },
        },
        { session: localSession },
      );

      // 5.3 insert ledger status RELEASED
      const baseIdem = `release:${masterOrderId}:${now.getTime()}`;
      const docs = reservations.map((g) => ({
        skuId: g.skuId,
        productId: g.productId, // ถ้ามี
        storeId: g.storeId, // ถ้ามี stock per store
        masterOrderId: new Types.ObjectId(masterOrderId),
        op: "RELEASE" as const,
        qty: g.qty,
        referenceType: "master_order" as const,
        referenceId: new Types.ObjectId(masterOrderId),
        reason: "payment_timeout",
        idemKey: `${baseIdem}:${String(g.skuId)}`, // ↔ unique + sparse
        note: "auto release by expiry reaper",
      }));

      await this.ledgerModel.insertMany(docs, { session });

      if (!session) await localSession.commitTransaction();
    } catch (e) {
      if (!session) await localSession.abortTransaction();
      throw e;
    } finally {
      if (shouldEnd) await localSession.endSession();
    }
  }

  /**
   * (ทางเลือก) ปล่อยจาก cart โดยตรง
   */
  async releaseByCart(cartId: string, session?: ClientSession): Promise<void> {
    const query: FilterQuery<Reservation> = {
      cartId: new Types.ObjectId(cartId),
      status: "ACTIVE",
    };
    const exists = await this.reservationModel
      .exists(query)
      .session(session ?? null);
    if (!exists) return;

    const reservations = await this.reservationModel
      .find(query)
      .select({ _id: 1, skuId: 1, storeId: 1, qty: 1 })
      .lean()
      .session(session ?? null);

    if (reservations.length === 0) return;

    // รวม qty และอัปเดตเหมือนด้านบน
    const aggregateMap = new Map<
      string,
      { skuId: Types.ObjectId; storeId: Types.ObjectId; qty: number }
    >();
    for (const r of reservations) {
      const k = `${String(r.skuId)}::${String(r.storeId)}`;
      aggregateMap.set(k, {
        skuId: r.skuId,
        storeId: r.storeId,
        qty: (aggregateMap.get(k)?.qty ?? 0) + r.qty,
      });
    }

    const localSession = session ?? (await this.conn.startSession());
    const shouldEnd = !session;

    try {
      if (!session) localSession.startTransaction();

      const stockOps = Array.from(aggregateMap.values()).map((g) => ({
        updateOne: {
          filter: { skuId: g.skuId, storeId: g.storeId },
          update: {
            $inc: { reserved: -g.qty, available: +g.qty },
            $set: { updatedAt: new Date() },
          },
          upsert: true,
        },
      }));
      if (stockOps.length)
        await this.skuModel.bulkWrite(stockOps, { session: localSession });

      await this.reservationModel.updateMany(
        { _id: { $in: reservations.map((r) => r._id) }, status: "ACTIVE" },
        { $set: { status: "RELEASED", updatedAt: new Date() } },
        { session: localSession },
      );

      if (!session) await localSession.commitTransaction();
    } catch (e) {
      if (!session) await localSession.abortTransaction();
      throw e;
    } finally {
      if (shouldEnd) await localSession.endSession();
    }
  }
}
