import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { MongooseModule } from "@nestjs/mongoose";
import { User, UserSchema } from "src/user/schemas/user.schema";
import { UserModule } from "src/user/user.module";
import { PassportModule } from "@nestjs/passport";
import { JwtModule } from "@nestjs/jwt";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { Store, StoreSchema } from "src/store/schemas/store.schema";
import { CartCommonModule } from "src/cart/common/cart-common.module";

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || "defaultSecret",
      signOptions: { expiresIn: "7d" },
    }),
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Store.name, schema: StoreSchema },
    ]), // 👈 เพิ่มตรงนี้
    UserModule,
    CartCommonModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
})
export class AuthModule {}
