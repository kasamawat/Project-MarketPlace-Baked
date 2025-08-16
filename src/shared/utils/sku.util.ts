// shared/utils/sku.util.ts
export const BASE_NORMALIZED = "__BASE__"; // ใช้เป็นคีย์ normalized ของ SKU เดี่ยว

export function buildSkuCode(
  productName: string,
  attributes?: Record<string, string>,
): string {
  const base = productName
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9-]/g, "");

  if (!attributes || Object.keys(attributes).length === 0) {
    // โค้ดสำหรับ Base SKU เดี่ยว
    return `${base}-BASE`;
  }

  const parts = Object.entries(attributes)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}-${String(v).toUpperCase().replace(/\s+/g, "-")}`);
  return [base, ...parts].join("-");
}

export function normalizeAttributes(attrs?: Record<string, string>): string {
  const keys = Object.keys(attrs ?? {});
  if (keys.length === 0) return BASE_NORMALIZED; // ใช้คงที่สำหรับ Base SKU
  return Object.entries(attrs!)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v).trim().toUpperCase()}`)
    .join("|");
}
