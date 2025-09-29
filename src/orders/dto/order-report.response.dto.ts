// src/orders/dto/reports.dto.ts
import { ApiProperty } from "@nestjs/swagger";

class Summary {
  @ApiProperty() revenue!: number; // รวมรายได้ของร้าน (ตามช่วงเวลา)
  @ApiProperty() orders!: number; // จำนวนออเดอร์ (store orders)
  @ApiProperty() aov!: number; // revenue / orders (ถ้า orders=0 ให้เป็น 0)
}

class TopProduct {
  @ApiProperty() productId!: string; // productId หรือ skuId ตามที่ต้องการสรุป
  @ApiProperty() skuId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: Object, required: false })
  attributes?: Record<string, string>;
  @ApiProperty() fulfillStatus: string;
  @ApiProperty() qty!: number; // ยอดชิ้นรวม
  @ApiProperty() revenue!: number; // ยอดรายได้รวมของสินค้า
  @ApiProperty() deliveredAt!: string;
}

export class ReportsResponseDto {
  @ApiProperty({ type: Summary }) summary!: Summary;
  @ApiProperty({ type: [TopProduct] }) topProducts!: TopProduct[];
}
