import { FulfillmentInfo } from "../schemas/shared.subdocs";

type ItemCounters = {
  quantity: number;
  shippedQty?: number;
  deliveredQty?: number;
  canceledQty?: number;
};

export function computeFulfillmentInfo(
  items: ItemCounters[],
  prev?: FulfillmentInfo, // ส่ง order.fulfillment ปัจจุบันเข้ามา
): FulfillmentInfo {
  const totalItems = items.reduce((s, x) => s + (x.quantity || 0), 0);
  const shippedItems = items.reduce((s, x) => s + (x.shippedQty || 0), 0);
  const deliveredItems = items.reduce((s, x) => s + (x.deliveredQty || 0), 0);
  const canceledItems = items.reduce((s, x) => s + (x.canceledQty || 0), 0);

  let status: FulfillmentInfo["status"] = "UNFULFILLED";
  if (canceledItems >= totalItems && totalItems > 0) status = "CANCELED";
  else if (deliveredItems >= totalItems && totalItems > 0) status = "FULFILLED";
  else if (shippedItems > 0 || deliveredItems > 0)
    status = "PARTIALLY_FULFILLED";
  else status = "UNFULFILLED";

  return {
    status,
    shippedItems,
    deliveredItems,
    totalItems,
    packages: prev?.packages ?? [],
    shipments: prev?.shipments ?? [],
    timeline: prev?.timeline ?? [],
  };
}
