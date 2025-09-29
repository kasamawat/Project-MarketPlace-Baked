// src/notification/api/user-notifications.controller.ts
import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { AuthGuard } from "@nestjs/passport"; // หรือ JwtAuthGuard ของโปรเจคคุณ
import { CurrentUser } from "src/common/current-user.decorator"; // ปรับ path ให้ตรงโปรเจค
import { SseBus } from "src/realtime/sse.bus";
import {
  Notification,
  NotificationDocument,
} from "src/notification/schemas/notification-schema";
import { JwtPayload } from "src/auth/types/jwt-payload.interface";

type ListResp = { items: any[]; nextCursor: string | null };

@UseGuards(AuthGuard("jwt"))
@Controller("user/notifications")
export class UserNotificationsController {
  constructor(
    @InjectModel(Notification.name)
    private readonly notiModel: Model<NotificationDocument>,
    private readonly sseBus: SseBus,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query("status") status?: "UNREAD" | "READ" | "ARCHIVED",
    @Query("limit") limitStr?: string,
    @Query("cursor") cursor?: string,
  ): Promise<ListResp> {
    const userId = new Types.ObjectId(user.userId);
    const limit = Math.min(
      Math.max(parseInt(limitStr ?? "20", 10) || 20, 1),
      50,
    );

    const match: any = { userId };
    if (status) match.status = status;
    if (cursor) {
      if (!Types.ObjectId.isValid(cursor))
        throw new BadRequestException("invalid cursor");
      match._id = { $lt: new Types.ObjectId(cursor) };
    }

    const docs = await this.notiModel
      .find(match)
      .sort({ _id: -1 })
      .limit(limit)
      .lean()
      .exec();

    const nextCursor =
      docs.length === limit ? String(docs[docs.length - 1]._id) : null;

    return { items: docs, nextCursor };
  }

  @Get("counts")
  async counts(@CurrentUser() user: JwtPayload) {
    const userId = new Types.ObjectId(user.userId);
    const [unread, total] = await Promise.all([
      this.notiModel.countDocuments({ userId, status: "UNREAD" }),
      this.notiModel.countDocuments({ userId }),
    ]);
    return { unread, total };
  }

  @Patch(":id/read")
  async markRead(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
  ): Promise<{ ok: true }> {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException("invalid id");

    const userId = new Types.ObjectId(user.userId);
    const now = new Date();

    const res = await this.notiModel.updateOne(
      { _id: new Types.ObjectId(id), userId, status: "UNREAD" },
      { $set: { status: "READ", readAt: now } },
    );

    if (!res.matchedCount) throw new NotFoundException();

    // แจ้ง badge/ซิงก์ข้ามแท็บ (optional)
    this.sseBus.pushToUser(user.userId, {
      type: "notification_read",
      payload: { id },
    });

    return { ok: true }; // FE ใช้ res.ok อยู่แล้ว
  }

  @Post("mark-all-read")
  async markAllRead(
    @CurrentUser() user: JwtPayload,
  ): Promise<{ ok: true; modified: number }> {
    const userId = new Types.ObjectId(user.userId);
    const now = new Date();
    const res = await this.notiModel.updateMany(
      { userId, status: "UNREAD" },
      { $set: { status: "READ", readAt: now } },
    );

    // อัปเดต badge ข้ามแท็บ (optional)
    this.sseBus.pushToUser(user.userId, {
      type: "notification_badge",
      payload: { unread: 0 },
    });

    return { ok: true, modified: res.modifiedCount ?? 0 };
  }
}
