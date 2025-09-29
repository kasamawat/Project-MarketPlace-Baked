import { Module } from "@nestjs/common";
import { StoreFollowService } from "./store-follow.service";
import { StoreFollowController } from "./store-follow.controller";
import { MongooseModule } from "@nestjs/mongoose";
import { StoreFollow } from "./entities/store-follow.entity";
import { StoreFollowSchema } from "./schemas/store-follow.schema";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: StoreFollow.name, schema: StoreFollowSchema },
    ]),
  ],
  controllers: [StoreFollowController],
  providers: [StoreFollowService],
  exports: [StoreFollowService],
})
export class StoreFollowModule {}
