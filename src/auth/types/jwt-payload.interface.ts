// src/auth/types/jwt-payload.interface.ts
export interface JwtPayload {
  userId: string;
  email: string;
  username: string;
  storeId?: string;
}
