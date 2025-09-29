export function splitTokensByScript(raw: string) {
  const cleaned = (raw || "")
    .replace(/[^\p{L}\p{Nd}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const parts = cleaned ? cleaned.split(" ") : [];
  const th: string[] = [];
  const en: string[] = [];
  const other: string[] = [];

  for (const p of parts) {
    if (/^[\u0E00-\u0E7F]+$/.test(p))
      th.push(p); // ไทยล้วน
    else if (/^[A-Za-z0-9]+$/.test(p))
      en.push(p); // อังกฤษ/ตัวเลขล้วน
    else other.push(p); // ปนกัน
  }
  return { th, en, other };
}
