import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import {
  StoreFollow,
  StoreFollowDocument,
} from "./schemas/store-follow.schema";
import { Model, Types } from "mongoose";

@Injectable()
export class StoreFollowService {
  constructor(
    @InjectModel(StoreFollow.name)
    private readonly followModel: Model<StoreFollowDocument>,
  ) {}

  async follow(userId: string, storeId: string) {
    if (userId === String(storeId))
      throw new BadRequestException("Invalid Follow");

    const userIdObj = new Types.ObjectId(userId);
    const storeIdObj = new Types.ObjectId(storeId);

    const res = await this.followModel.updateOne(
      { userId: userIdObj, storeId: storeIdObj },
      {
        $setOnInsert: {
          userId: userIdObj,
          storeId: storeIdObj,
          createdAt: new Date(),
        },
      },
      { upsert: true, rawResult: true },
    );

    const created = !!res.upsertedId;

    // (ออปชัน) $inc stores.followersCount + ส่ง outbox event

    return { ok: true, created };
  }

  async unfollow(userId: string, storeId: string) {
    const userIdObj = new Types.ObjectId(userId);
    const storeIdObj = new Types.ObjectId(storeId);

    const res = await this.followModel.deleteOne({
      userId: userIdObj,
      storeId: storeIdObj,
    });

    // (ออปชัน) $inc stores.followersCount -1 + outbox event

    return { ok: true, modified: res.deletedCount };
  }

  async isFollowing(userId: string, storeId: string) {
    const userIdObj = new Types.ObjectId(userId);
    const storeIdObj = new Types.ObjectId(storeId);
    const exists = await this.followModel.exists({
      userId: userIdObj,
      storeId: storeIdObj,
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
    });
    return { following: !!exists };
  }
}
