// src/auth/strategies/jwt.strategy.ts

import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { Request } from "express";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error("JWT_SECRET environment variable is not defined");
    }
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => {
          return req.cookies?.token || null;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: jwtSecret, // อย่าลืม set ENV
    });
  }

  validate(payload: any) {
    return {
      userId: payload.id, // ตรงกับสิ่งที่คุณ sign มาตอน login
      email: payload.email,
    };
  }
}
