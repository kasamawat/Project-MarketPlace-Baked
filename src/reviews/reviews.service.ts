/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { CreateReviewDto } from "./dto/create-review.dto";
// import { UpdateReviewDto } from "./dto/update-review.dto";
import { InjectConnection, InjectModel } from "@nestjs/mongoose";
import { Review, ReviewDocument } from "./schemas/review.schema";
import { Connection, Model, Types } from "mongoose";
import {
  StoreOrder,
  StoreOrderDocument,
} from "src/orders/schemas/store-order.schema";
import { JwtPayload } from "src/auth/types/jwt-payload.interface";

@Injectable()
export class ReviewsService {
  constructor(
    @InjectModel(Review.name)
    private readonly reviewModel: Model<ReviewDocument>,
    @InjectModel(StoreOrder.name)
    private readonly storeOrderModel: Model<StoreOrderDocument>,
    @InjectConnection() private readonly conn: Connection,
  ) {}

  async create(
    dto: CreateReviewDto,
    user: JwtPayload,
    // imageUrls: string[] = [],
  ) {
    const buyerId = new Types.ObjectId(user.userId);

    const masterOrderIdObj = new Types.ObjectId(dto.masterOrderId);
    const storeOrderIdObj = new Types.ObjectId(dto.storeOrderId);

    const storeIdObj = new Types.ObjectId(dto.storeId);
    const productIdObj = new Types.ObjectId(dto.productId);
    const skuIdObj = new Types.ObjectId(dto.skuId);

    // 1) ตรวจสิทธิ์: เป็นออเดอร์ของ user และสถานะ DELIVERED
    const so = await this.storeOrderModel
      .findOne({
        _id: storeOrderIdObj,
        buyerId,
        storeId: storeIdObj,
      })
      .lean();

    if (!so) throw new NotFoundException("Store order not found");
    if (so.status !== "DELIVERED") {
      throw new ForbiddenException("Order not delivered yet");
    }

    const session = await this.conn.startSession();
    session.startTransaction();
    try {
      // 2) สร้างรีวิว (unique index กันซ้ำ)
      const created = await this.reviewModel
        .create(
          [
            {
              masterOrderId: masterOrderIdObj,
              storeOrderId: storeOrderIdObj,
              storeId: storeIdObj,
              buyerId,
              productId: productIdObj,
              skuId: dto.skuId ? skuIdObj : undefined,
              rating: dto.rating,
              comment: dto.comment,
              // imageUrls,
              status: "published",
            },
          ],
          { session },
        )
        .then((r) => r[0]);

      // 3) อัปเดต flag ใน StoreOrder.items.$ ของ item ที่ตรง product/sku
      const itemFilter = {
        _id: storeOrderIdObj,
        "items.productId": productIdObj,
      };
      if (dto.skuId) itemFilter["items.skuId"] = skuIdObj;

      const upd = await this.storeOrderModel.updateOne(
        itemFilter,
        {
          $set: {
            "items.$.reviewed": true,
            "items.$.reviewId": created._id,
            "items.$.reviewedAt": new Date(),
          },
        },
        { session },
      );

      if (upd.modifiedCount !== 1) {
        throw new BadRequestException("Failed to mark item as reviewed");
      }

      await session.commitTransaction();
      return { ok: true, id: String(created._id) };
    } catch (e) {
      await session.abortTransaction();
      if (e?.code === 11000) throw new BadRequestException("Duplicate review");
      throw e;
    } finally {
      await session.endSession();
    }
  }

  // อ่านรีวิวของสินค้า (หน้า product)
  async listByProduct(productId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const filter = {
      productId: new Types.ObjectId(productId),
      status: "published",
    };
    const [items, total] = await Promise.all([
      this.reviewModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.reviewModel.countDocuments(filter),
    ]);
    return { items, total, page, limit };
  }

  // รีวิวของฉัน (ผู้ซื้อ)
  async listMine(user: JwtPayload, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const buyerId = new Types.ObjectId(user.userId);
    const filter = { buyerId };
    const [items, total] = await Promise.all([
      this.reviewModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.reviewModel.countDocuments(filter),
    ]);
    return { items, total, page, limit };
  }
}
