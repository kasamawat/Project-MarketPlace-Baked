// src/orders/mappers/order.mapper.ts
import { OrderDetailResponseDto } from "../dto/order.response.dto";
import { OrderLean } from "../types/order-lean.types";

export function mapOrderToDetailDto(order: OrderLean): OrderDetailResponseDto {
  return {
    _id: String(order._id),
    userId: order.userId ? String(order.userId) : undefined,
    cartId: String(order.cartId),
    currency: order.currency,
    items: order.items.map((it) => ({
      productId: String(it.productId),
      skuId: String(it.skuId),
      storeId: String(it.storeId),
      productName: it.productName,
      productImage: it.productImage,
      attributes: it.attributes ?? {},
      unitPrice: it.unitPrice,
      quantity: it.quantity,
      subtotal: it.subtotal,
    })),
    itemsCount: order.itemsCount,
    itemsTotal: order.itemsTotal,
    status: order.status,
    payment: order.payment ? { ...order.payment } : undefined,
    reservationExpiresAt: order.reservationExpiresAt?.toISOString(),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}
