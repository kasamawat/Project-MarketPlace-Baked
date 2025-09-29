import { BadRequestException } from "@nestjs/common";

export function parseRange({ from, to }: { from?: string; to?: string }) {
  // ถ้าไม่ส่งมา: default = 7 วันล่าสุด (รวมวันนี้)
  const today = new Date();
  const startDefault = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - 6,
    0,
    0,
    0,
    0,
  );
  const endDefault = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    23,
    59,
    59,
    999,
  );

  const start = from
    ? new Date(`${from}T00:00:00.000Z`) // ถ้าใช้ TZ ไทย อยากเปลี่ยน logic ตาม TZ ได้
    : startDefault;
  const end = to ? new Date(`${to}T23:59:59.999Z`) : endDefault;

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new BadRequestException("Invalid date range");
  }
  if (start > end) {
    throw new BadRequestException("`from` must be before `to`");
  }
  return { start, end };
}
