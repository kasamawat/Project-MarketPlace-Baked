import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Image, ImageSchema } from "./schemas/image.schema";
import { ImagesService } from "./images.service";
import { CloudinaryModule } from "src/uploads/uploads.module";
import { Sku, SkuSchema } from "src/skus/schemas/sku-schema";

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Image.name, schema: ImageSchema }]),
    MongooseModule.forFeature([{ name: Sku.name, schema: SkuSchema }]),
    CloudinaryModule,
  ],
  providers: [ImagesService],
  exports: [ImagesService],
})
export class ImagesModule {}
