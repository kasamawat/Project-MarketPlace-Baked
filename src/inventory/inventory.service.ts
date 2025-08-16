// inventory.service.ts
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { InjectModel, InjectConnection } from "@nestjs/mongoose";
import { Model, Types, Connection } from "mongoose";
import {
  InventoryLedger,
  InventoryLedgerDocument,
} from "./schemas/inventory-ledger.schema";
import { Reservation, ReservationDocument } from "./schemas/reservation.schema";
import { Sku, SkuDocument } from "src/skus/schemas/sku-schema";
import { AdjustInventoryDto } from "./dto/adjust-inventory.dto";
import { JwtPayload } from "src/auth/types/jwt-payload.interface";
import { SkuLeanRaw } from "src/products/dto/response-skus.dto";

@Injectable()
export class InventoryService {
  constructor(
    @InjectModel(InventoryLedger.name)
    private ledgerModel: Model<InventoryLedgerDocument>,
    @InjectModel(Reservation.name)
    private reservationModel: Model<ReservationDocument>,
    @InjectModel(Sku.name) private skuModel: Model<SkuDocument>,
    @InjectConnection() private readonly connection: Connection,
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
    qty: number,
    opts: { cartId?: string; userId?: string; ttlMinutes?: number } = {},
  ) {
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new BadRequestException("qty must be a positive integer");
    }

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        // 1) อัปเดตแบบอะตอมมิก: กัน oversell ด้วยเงื่อนไขคำนวณ onHand - reserved >= qty
        const result = await this.skuModel.updateOne(
          {
            _id: new Types.ObjectId(skuId),
            $expr: { $gte: [{ $subtract: ["$onHand", "$reserved"] }, qty] },
          },
          { $inc: { reserved: qty } },
          { session },
        );

        if (result.modifiedCount === 0) {
          throw new BadRequestException("Not enough stock");
        }

        // 2) บันทึก ledger
        await this.ledgerModel.create(
          [
            {
              skuId: new Types.ObjectId(skuId),
              op: "RESERVE",
              qty,
              referenceType: "cart",
              referenceId: opts.cartId,
            },
          ],
          { session },
        );

        // 3) สร้าง reservation (สำหรับปล่อยของคืนภายหลัง)
        await this.reservationModel.create(
          [
            {
              skuId: new Types.ObjectId(skuId),
              qty,
              cartId: opts.cartId,
              userId: opts.userId,
              expiresAt: new Date(
                Date.now() + (opts.ttlMinutes ?? 20) * 60_000,
              ),
            },
          ],
          { session },
        );
      });
    } finally {
      await session.endSession();
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
}
