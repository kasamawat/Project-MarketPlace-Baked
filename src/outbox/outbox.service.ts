// outbox/outbox.service.ts
import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { Outbox, OutboxDocument } from "./schemas/outbox.schema";

@Injectable()
export class OutboxService {
  constructor(
    @InjectModel(Outbox.name) private outBoxModel: Model<OutboxDocument>,
  ) {}

  async add(topic: string, payload: any) {
    await this.outBoxModel.create({
      topic,
      payload,
      status: "PENDING",
      attempts: 0,
      nextAttemptAt: new Date(),
    });
  }

  async pullBatch(limit = 50) {
    const now = new Date();

    const data = this.outBoxModel
      .find({
        status: "PENDING",
        $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
      })
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean();

    // console.log(data, "data");
    return data;
  }

  async markSent(id: any) {
    await this.outBoxModel.updateOne(
      { _id: id },
      { $set: { status: "SENT", errorMsg: null } },
    );
  }

  async markFailed(id: any, err: any, attempt = 0) {
    const delaySec = Math.min(60, Math.pow(2, attempt)); // 1,2,4,8,16,32,60s
    const next = new Date(Date.now() + delaySec * 1000);
    await this.outBoxModel.updateOne(
      { _id: id },
      {
        $set: { status: "PENDING", errorMsg: String(err), nextAttemptAt: next },
        $inc: { attempts: 1 },
      },
    );
  }
}
