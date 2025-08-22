import { Module, Global } from "@nestjs/common";
import { SseBus } from "./sse.bus";

/** ถ้าต้องการใช้ได้ทุกที่โดยไม่ต้อง import ทุกโมดูล ให้ใส่ @Global() */
@Global()
@Module({
  providers: [SseBus],
  exports: [SseBus],
})
export class RealtimeModule {}
