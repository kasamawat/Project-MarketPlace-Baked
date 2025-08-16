import { Module } from "@nestjs/common";
import { SkusController } from "./skus.controller";
import { SkusService } from "./skus.service";
import { MongooseModule } from "@nestjs/mongoose";
import { Sku, SkuSchema } from "./schemas/sku-schema";

// ✅ ประกาศเป็น const เพื่อ reuse ทั้ง imports/exports
const SkuFeature = MongooseModule.forFeature([
  { name: Sku.name, schema: SkuSchema },
]);

@Module({
  imports: [SkuFeature],
  controllers: [SkusController],
  providers: [SkusService],
  exports: [SkuFeature, SkusService],
})
export class SkusModule {}
