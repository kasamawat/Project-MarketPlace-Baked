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
  ],
  controllers: [AppController, OrdersController, PaymentsController],
  providers: [AppService],
})
export class AppModule {}
