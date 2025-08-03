// dto/store-info.dto.ts
import { Expose } from "class-transformer";

export class StoreInfoDto {
  @Expose() name: string;
  @Expose() slug: string;
  @Expose() description?: string;
  @Expose() logoUrl?: string;
  @Expose() coverUrl?: string;
  @Expose() phone?: string;
  @Expose() bankName?: string;
  @Expose() bankAccountNumber?: string;
  @Expose() bankAccountName?: string;
  @Expose() productCategory?: string;
  @Expose() returnPolicy?: string;
  @Expose() status: "pending" | "approved" | "rejected";
  @Expose() createdAt: Date;
}
