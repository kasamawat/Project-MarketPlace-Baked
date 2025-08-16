// src/inventory/dto/adjust-inventory.dto.ts
import { IsInt, IsString } from "class-validator";
export class AdjustInventoryDto {
  @IsInt() delta!: number; // + เพิ่มสต๊อก / - ลดสต๊อก
  @IsString() reason!: string; // eg. "manual", "restock", "receive", "shrinkage"
}
