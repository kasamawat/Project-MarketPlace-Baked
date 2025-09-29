import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { UserService } from "./user.service";
import { UserController } from "./user.controller";
import { User, UserSchema } from "./schemas/user.schema";
import { Image, ImageSchema } from "src/images/schemas/image.schema";
import { ImagesModule } from "src/images/images.module";
import { OutboxModule } from "src/outbox/outbox.module";
import { CloudinaryModule } from "src/uploads/uploads.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Image.name, schema: ImageSchema },
    ]),
    CloudinaryModule,
    ImagesModule,
    OutboxModule,
  ],
  providers: [UserService],
  controllers: [UserController],
  exports: [UserService, MongooseModule],
})
export class UserModule {}
