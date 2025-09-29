// src/realtime/notifications/notifications.stream.controller.ts
import { Controller, Sse, MessageEvent, UseGuards } from "@nestjs/common";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { SseBus } from "../sse.bus";
import { AuthGuard } from "@nestjs/passport"; // หรือ JwtAuthGuard ที่คุณใช้
import { CurrentUser } from "src/common/current-user.decorator";
import { JwtPayload } from "src/auth/types/jwt-payload.interface";

@Controller("realtime/notifications")
export class NotificationsStreamController {
  constructor(private readonly bus: SseBus) {}

  @UseGuards(AuthGuard("jwt"))
  @Sse("stream")
  stream(@CurrentUser() payload: JwtPayload): Observable<MessageEvent> {
    // แปลง NotiEvent -> SSE MessageEvent
    return this.bus
      .streamUser(payload.userId)
      .pipe(map((evt) => ({ data: JSON.stringify(evt) })));
  }
}
