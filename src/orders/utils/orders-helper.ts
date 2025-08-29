// utilities (ของคุณน่าจะมีแล้ว): getOrCreateCart, toClient

import { ForbiddenException } from "@nestjs/common";
import { MasterOrder } from "../schemas/master-order.schema";
import { BuyerListStatus } from "../types/order.types";
import { BuyerDetailFacet } from "../types/buyer-order.types";

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
): BuyerListStatus {
  if (m.status === "pending_payment") {
    const ps = m.payment?.status;
    if (ps === "processing") return "processing";
    if (ps === "requires_action") return "paying";
    return "pending_payment";
  }
  return m.status;
}

export type PayCoreStatus = "pending_payment" | "paid" | "expired" | "canceled";
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

export type BuyerStatus =
  | "pending_payment"
  | "paying"
  | "processing"
  | "paid"
  | "shipped"
  | "delivered"
  | "canceled"
  | "expired";

export type MasterForStatus = {
  status: PayCoreStatus; // << รับเฉพาะแกนจ่ายเงินของ Master
  payment?: { status?: PayDetailStatus | null } | null;
  // optional: ถ้าไม่ส่งมา จะถือว่ายังไม่ shipped/delivered
  stores?: Array<{ items?: Array<{ fulfillStatus: FulfillItemStatus }> }>;
};

function summarizeFulfillment(stores?: MasterForStatus["stores"]) {
  if (!stores?.length) return { anyShipped: false, allDelivered: false };
  let anyShipped = false;
  let allDelivered = true;
  for (const s of stores) {
    for (const it of s.items ?? []) {
      if (it.fulfillStatus === "SHIPPED") anyShipped = true;
      if (it.fulfillStatus !== "DELIVERED") allDelivered = false;
    }
  }
  return { anyShipped, allDelivered };
}

export function computeListStatusBuyer(m: MasterForStatus): BuyerStatus {
  if (m.status === "expired") return "expired";
  if (m.status === "canceled") return "canceled";

  if (m.status === "pending_payment") {
    const ps = m.payment?.status;
    if (ps === "requires_action") return "paying";
    if (ps === "processing") return "processing";
    return "pending_payment";
  }

  // paid
  const { anyShipped, allDelivered } = summarizeFulfillment(m.stores);
  if (allDelivered) return "delivered";
  if (anyShipped) return "shipped";
  return "paid";
}
