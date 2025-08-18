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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
