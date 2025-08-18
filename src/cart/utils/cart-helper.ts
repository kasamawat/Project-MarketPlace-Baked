import { Request, Response } from "express";
// helper อ่าน user (optional) และ cartId cookie

export function setCartCookie(res: Response, key: string, maxAgeSec: number) {
  res.cookie("cartId", key, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: maxAgeSec * 1000,
    path: "/",
  });
}
