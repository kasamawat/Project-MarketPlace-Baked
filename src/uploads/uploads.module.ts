import { Module } from "@nestjs/common";
import { CloudinaryService } from "./uploads.service";

@Module({
  providers: [CloudinaryService],
  exports: [CloudinaryService],
})
export class CloudinaryModule {}
