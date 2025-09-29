import { Module } from "@nestjs/common";
import { ReviewsService } from "./reviews.service";
import { ReviewsController } from "./reviews.controller";
import { MongooseModule } from "@nestjs/mongoose";
import { Review, ReviewSchema } from "./schemas/review.schema";
import {
  StoreOrder,
  StoreOrderSchema,
} from "src/orders/schemas/store-order.schema";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Review.name, schema: ReviewSchema },
      { name: StoreOrder.name, schema: StoreOrderSchema },
    ]),
  ],
  controllers: [ReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsModule],
})
export class ReviewsModule {}
