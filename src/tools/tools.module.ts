import { Module } from "@nestjs/common";
import { ToolsController } from "./tools.controller";

@Module({
  controllers: [ToolsController],
  providers: [],
  exports: [], // ถ้าต้องการใช้ที่อื่น
})
export class ToolsModule {}
