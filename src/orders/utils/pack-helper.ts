import { FulfillStatus } from "../schemas/shared.subdocs";

export function computeItemStatus(
  qty: number,
  packed: number,
  shipped: number,
  delivered: number,
  canceled: number,
): FulfillStatus {
  if (canceled >= qty) return "CANCELED";
  if (delivered >= qty) return "DELIVERED";
  if (shipped >= qty) return "SHIPPED";
  if (shipped > 0) return "PARTIALLY_SHIPPED";
  if (packed >= qty) return "PACKED";
  if (packed > 0) return "PARTIALLY_PACKED";
  return "PENDING";
}
