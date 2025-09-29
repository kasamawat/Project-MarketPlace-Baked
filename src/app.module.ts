import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { AuthModule } from "./auth/auth.module";
import { UserModule } from "./user/user.module";
import { MongooseModule } from "@nestjs/mongoose";
import { ConfigModule } from "@nestjs/config";
import { StoreModule } from "./store/store.module";
import { ProductsModule } from "./products/products.module";
import { SkusModule } from "./skus/skus.module";
import { InventoryModule } from "./inventory/inventory.module";
import { ProductPublicModule } from "./products/public/product-public.module";
import { StorePublicModule } from "./store/public/store-public.module";
import { CartModule } from "./cart/cart.module";
import { OrdersController } from "./orders/orders.controller";
import { OrdersModule } from "./orders/orders.module";
import { PaymentsController } from "./payments/payments.controller";
import { PaymentsModule } from "./payments/payments.module";
import { MessagingModule } from "./messaging/messaging.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { ScheduleModule } from "@nestjs/schedule";
import { WebhooksModule } from "./webhooks/webhooks.module";
import { WebhooksController } from "./webhooks/webhooks.controller";
import { ToolsModule } from "./tools/tools.module";
import { NotificationModule } from "./notification/notification.module";
import { UploadsController } from "./uploads/uploads.controller";
import { CloudinaryModule } from "./uploads/uploads.module";
import { ImagesController } from "./images/images.controller";
import { ImagesModule } from "./images/images.module";
import { SearchController } from "./search/search.controller";
import { SearchModule } from "./search/search.module";
import { OutboxModule } from "./outbox/outbox.module";
import { StoreFollowModule } from "./store-follow/store-follow.module";
import { ReviewsModule } from './reviews/reviews.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env.local", ".env"],
    }),
    MongooseModule.forRoot(process.env.MONGODB_URI!),
    AuthModule,
    UserModule,
    StoreModule,
    StorePublicModule,
    ProductsModule,
    ProductPublicModule,
    SkusModule,
    InventoryModule,
    CartModule,
    OrdersModule,
    PaymentsModule,
    MessagingModule,
    RealtimeModule,
    WebhooksModule,
    ToolsModule,
    NotificationModule,
    CloudinaryModule,
    ImagesModule,
    SearchModule,
    OutboxModule,
    StoreFollowModule,
    ReviewsModule,
  ],
  controllers: [
    AppController,
    OrdersController,
    PaymentsController,
    WebhooksController,
    UploadsController,
    ImagesController,
    SearchController,
    // OutboxController,
  ],
  providers: [AppService],
})
export class AppModule {}
