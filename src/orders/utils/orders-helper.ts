// utilities (ของคุณน่าจะมีแล้ว): getOrCreateCart, toClient

import { ForbiddenException } from "@nestjs/common";
import { MasterOrder } from "../schemas/master-order.schema";
import { BuyerDetailFacet } from "../types/buyer-order.types";
import { MasterStatus } from "../schemas/shared.subdocs";

export function ensureOwnershipMaster(
  doc: Pick<MasterOrder, "buyerId">,
  userId?: string,
) {
  if (!userId) return; // อนุโลม guest ได้ตามนโยบายคุณ
  if (doc?.buyerId && String(doc.buyerId) !== String(userId)) {
    throw new ForbiddenException("Not your order");
  }
}

export function computeListStatusMaster(
  m: Pick<BuyerDetailFacet, "status" | "payment">,
): MasterStatus {
  if (m.status === "pending_payment") {
    return "pending_payment";
  }
  return m.status;
}
export type PayDetailStatus =
  | "requires_action"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled";

export type FulfillItemStatus =
  | "AWAITING_PAYMENT"
  | "PENDING"
  | "PACKED"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELED"
  | "RETURNED";

export type MasterForStatus = {
  status: MasterStatus; // << รับเฉพาะแกนจ่ายเงินของ Master
  payment?: { status?: PayDetailStatus | null } | null;
  // optional: ถ้าไม่ส่งมา จะถือว่ายังไม่ shipped/delivered
  stores?: Array<{ items?: Array<{ fulfillStatus: FulfillItemStatus }> }>;
};

// function summarizeFulfillment(stores?: MasterForStatus["stores"]) {
//   if (!stores?.length) return { anyShipped: false, allDelivered: false };
//   let anyShipped = false;
//   let allDelivered = true;
//   for (const s of stores) {
//     for (const it of s.items ?? []) {
//       if (it.fulfillStatus === "SHIPPED") anyShipped = true;
//       if (it.fulfillStatus !== "DELIVERED") allDelivered = false;
//     }
//   }
//   return { anyShipped, allDelivered };
// }

export function computeListStatusBuyer(m: MasterForStatus): MasterStatus {
  if (m.status === "expired") return "expired";
  if (m.status === "canceled") return "canceled";

  if (m.status === "pending_payment") {
    return "pending_payment";
  }

  return "paid";
}
