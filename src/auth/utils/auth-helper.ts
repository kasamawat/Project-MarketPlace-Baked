import { Request, Response } from "express";

export function setAuthCookie(res: Response, key: string, maxAgeSec: number) {
  res.cookie("token", key, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: maxAgeSec * 1000,
    path: "/",
  });
}
