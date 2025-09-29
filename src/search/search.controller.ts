// search.controller.ts
import { Controller, Get, Query } from "@nestjs/common";
import { SearchService } from "./search.service";

@Controller("search")
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  async fillSearch(
    @Query("q") q: string,
    @Query("type") type = "all",
    @Query("page") page = "1",
    @Query("limit") limit = "20",
    @Query("sort") sort?: "relevance" | "price_asc" | "price_desc" | "latest",
    @Query("category") category?: string,
    @Query("brand") brand?: string,
  ) {
    const filters = {
      category: category ? category.split(",") : undefined,
      brand: brand ? brand.split(",") : undefined,
    };

    const p = parseInt(page) || 1;
    const l = Math.min(50, parseInt(limit) || 20);

    if (type === "stores") {
      return { type, ...(await this.search.searchStores(q ?? "", p, l)) };
    }
    if (type === "products") {
      return {
        type,
        ...(await this.search.searchProducts(q ?? "", filters, p, l, sort)),
      };
    }

    // type === 'all' ยิงคู่ขนานแล้วรวมผล
    const [products, stores] = await Promise.all([
      this.search.searchProducts(q ?? "", filters, p, l, sort),
      this.search.searchStores(q ?? "", p, Math.max(5, Math.floor(l / 2))),
    ]);
    return { type: "all", products, stores };
  }

  @Get("suggest")
  async suggest(@Query("q") q: string) {
    if (!q?.trim()) return [];
    const [p] = await Promise.all([
      this.search.suggestProducts(q.trim()),
      this.search.suggestStores(q.trim()),
    ]);
    // รวม + ตัดซ้ำ + จำกัด 8 รายการ
    const merged = Array.from(new Set([...p])).slice(0, 8);
    return merged;
  }
}
