// auth/optional-jwt.guard.ts
import { Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard("jwt") {
  handleRequest(err: any, user: any) {
    // ถ้าไม่มี token / token ไม่โอเค -> ไม่ throw; คืน null
    if (err || !user) return null;
    return user;
  }
}
