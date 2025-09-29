// search/search.service.ts
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Client } from "@opensearch-project/opensearch";
import { OPENSEARCH_CLIENT } from "./opensearch.module";
import {
  ProductHit,
  StoreHit,
  SearchProductsResponse,
  SearchStoresResponse,
  SuggestOption,
  ProductFilters,
  ProductFacets,
} from "./types/types";
import { ProductAggs, TermsBucket } from "./types/os-types";
import { splitTokensByScript } from "./helper/search-helper";

const PRODUCTS_INDEX = process.env.SEARCH_PRODUCTS_INDEX ?? "products_v1";
const STORES_INDEX = process.env.SEARCH_STORES_INDEX ?? "stores_v1";

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(@Inject(OPENSEARCH_CLIENT) private readonly os: Client) {}

  // ----------------- PRODUCTS -----------------

  async searchProducts(
    q: string,
    filters: ProductFilters,
    page = 1,
    limit = 20,
    sort?: "relevance" | "price_asc" | "price_desc" | "latest",
  ): Promise<SearchProductsResponse> {
    const from = Math.max(0, (page - 1) * limit);

    const { th, en, other } = splitTokensByScript(q);
    const thTokens = th.filter((t) => t.length >= 1); // ไทย ≥1
    const enTokens = en.filter((t) => t.length >= 1); // ✅ อังกฤษ ≥1 ตามที่ต้องการ
    const otherTokens = other.filter((t) => t.length >= 2);

    const tokens = [...thTokens, ...enTokens, ...otherTokens];
    const should: object[] = [];

    // Fallback
    const raw = (q ?? "").trim();
    const thaiChars = raw.match(/[\u0E00-\u0E7F]/g) || [];
    const lastThai = thaiChars.at(-1);
    if (lastThai) {
      should.push({
        match: {
          name_auto_th: { query: lastThai, fuzziness: "AUTO", boost: 4 },
        },
      });
    }
    const asciiChars = raw.match(/[A-Za-z]/g) || [];
    const lastAscii = asciiChars.at(-1);
    if (lastAscii) {
      // อังกฤษ 1 ตัว → ให้ boost เบากว่าไทย
      should.push({
        match: {
          name_auto_en: { query: lastAscii, fuzziness: "AUTO", boost: 1.2 },
        },
      });
    }

    // Fill Tokens TH
    for (const t of thTokens) {
      should.push(
        { match: { name_auto_th: { query: t, fuzziness: "AUTO", boost: 3 } } },
        {
          multi_match: {
            query: t,
            fields: ["name^5", "brand^3", "description"],
            type: "best_fields",
            fuzziness: "AUTO",
            boost: 1,
          },
        },
        { match: { name_infix_th: { query: t, boost: 1 } } },
      );
    }

    // Fill Tokens ENG
    for (const t of enTokens) {
      const single = t.length === 1;
      const base = single ? 1.2 : 2; // เดินเกม: ยอมรับ 1 ตัว แต่ boost เบา ๆ
      should.push(
        {
          match: { name_auto_en: { query: t, fuzziness: "AUTO", boost: base } },
        },
        {
          multi_match: {
            query: t,
            fields: ["name^5", "brand^3", "description"],
            type: "best_fields",
            fuzziness: "AUTO",
            boost: base - 0.5,
          },
        },
        { match: { name_infix_en: { query: t, boost: base - 1 } } },
      );
    }

    // Fill Tokens Other
    for (const t of otherTokens) {
      should.push(
        {
          match: { name_auto_en: { query: t, fuzziness: "AUTO", boost: 1.2 } },
        },
        { match: { name_infix: { query: t, boost: 0.8 } } },
      );
    }

    const filter: object[] = [];
    if (filters?.category?.length)
      filter.push({ terms: { category: filters.category } });
    if (filters?.brand?.length)
      filter.push({ terms: { "brand.raw": filters.brand } });
    if (filters?.priceMin != null || filters?.priceMax != null) {
      filter.push({
        range: {
          price: {
            gte: filters.priceMin ?? 0,
            lte: filters.priceMax ?? 9_999_999,
          },
        },
      });
    }
    if (filters?.ratingMin != null)
      filter.push({ range: { rating: { gte: filters.ratingMin } } });
    if (filters?.available != null)
      filter.push({ term: { isAvailable: filters.available } });

    // ถ้าไม่มี tokens ให้ใช้ match_all
    const hasSignal = tokens.length > 0 || !!lastThai || !!lastAscii;
    const baseQuery = hasSignal
      ? { bool: { should, minimum_should_match: 1, filter } }
      : { bool: { must: [{ match_all: {} }], filter } };

    const query: object = {
      function_score: {
        query: baseQuery,
        boost_mode: "sum",
        score_mode: "sum",
        functions: [
          { field_value_factor: { field: "rating", factor: 0.5, missing: 0 } },
          {
            field_value_factor: {
              field: "soldCount",
              factor: 0.001,
              missing: 0,
            },
          },
          { gauss: { createdAt: { origin: "now", scale: "14d", decay: 0.5 } } },
        ],
      },
    };

    const sortSpec =
      sort === "price_asc"
        ? [{ price: "asc" as const }]
        : sort === "price_desc"
          ? [{ price: "desc" as const }]
          : sort === "latest"
            ? [{ createdAt: "desc" as const }]
            : [{ _score: "desc" as const }];

    const body = {
      from,
      size: limit,
      track_total_hits: true,
      timeout: "2s",
      query,
      sort: sortSpec,
      aggs: {
        byCategory: { terms: { field: "category", size: 50 } },
        byBrand: { terms: { field: "brand.raw", size: 50 } },
        priceStats: { stats: { field: "price" } },
        ratingHist: {
          histogram: { field: "rating", interval: 1, min_doc_count: 0 },
        },
      },
      _source: [
        "productId",
        "storeId",
        "name",
        "category",
        "type",
        "price",
        "cover",
        "rating",
        "soldCount",
        "createdAt",
      ] as string[],
    };

    const res = await this.os.search({ index: PRODUCTS_INDEX, body });
    const rawHits = res.body.hits.hits;
    const items: ProductHit[] = rawHits
      .map((h) => {
        const s = h._source as Record<string, any>;
        if (!s) return null;
        return {
          productId: String(s.productId ?? h._id),
          storeId: String(s.storeId),
          name: String(s.name),
          category: String(s.category),
          type: String(s.type),
          price: (s.price as number) ?? 0,
          cover: s.cover as { url: string } | undefined,
          rating: s.rating as number,
          soldCount: s.soldCount as number,
        };
      })
      .filter(Boolean) as ProductHit[];

    const totalRaw = res.body.hits.total;
    const total =
      typeof totalRaw === "number" ? totalRaw : (totalRaw?.value ?? 0);

    const aggs: ProductAggs = res.body?.aggregations ?? {};
    const facets: ProductFacets = {
      categories: (aggs.byCategory?.buckets as TermsBucket[]) ?? [],
      brands: aggs.byBrand?.buckets ?? [],
      priceStats: aggs.priceStats ?? undefined,
      ratingHist: aggs.ratingHist?.buckets ?? [],
    };

    return { items, total, facets, page, limit };
  }

  // ----------------- STORES -----------------

  async searchStores(
    q: string,
    page = 1,
    limit = 10,
  ): Promise<SearchStoresResponse> {
    const from = Math.max(0, (page - 1) * limit);

    const should: object[] = [];
    if (q?.trim()) {
      should.push(
        {
          match: {
            name_auto: {
              query: q,
              boost: 3,
            },
          },
        },
        {
          multi_match: {
            query: q,
            fields: ["name^5", "description"],
            type: "best_fields",
            fuzziness: "AUTO",
          },
        },
      );
    }

    const query: object = {
      function_score: {
        query: { bool: { should, minimum_should_match: 1 } },
        boost_mode: "sum",
        score_mode: "sum",
        functions: [
          { field_value_factor: { field: "rating", factor: 0.5, missing: 0 } },
          {
            field_value_factor: {
              field: "follower",
              factor: 0.001,
              missing: 0,
            },
          },
          { gauss: { createdAt: { origin: "now", scale: "30d", decay: 0.5 } } },
        ],
      },
    };

    const body = {
      from,
      size: limit,
      query,
      sort: [{ _score: "desc" as const }],
      _source: [
        "storeId",
        "name",
        "bannerUrl",
        "province",
        "rating",
      ] as string[],
    };

    const res = await this.os.search({ index: STORES_INDEX, body });
    const rawHits = res.body.hits.hits;

    // ป้องกัน _source undefined → กรองออกก่อน map
    const items: StoreHit[] = rawHits
      .map((h) => {
        const s = h._source;
        if (!s) return null; // กัน TS18048 และ runtime
        return {
          storeId: String(s.storeId ?? h._id),
          name: String(s.name),
          bannerUrl: String(s.bannerUrl),
          province: String(s.province),
          rating: s.rating as number,
        };
      })
      .filter(Boolean) as StoreHit[];

    // แตกเคส total: number | { value: number }
    const totalRaw = res.body.hits.total;
    const total =
      typeof totalRaw === "number" ? totalRaw : (totalRaw?.value ?? 0);

    return { items, total, page, limit };
  }

  async suggestProducts(prefix: string): Promise<string[]> {
    const body = {
      size: 0,
      suggest: {
        p1: { prefix, completion: { field: "suggest", size: 8 } },
      },
    };
    const res = await this.os.search({ index: PRODUCTS_INDEX, body });
    const opts = (res.body?.suggest?.p1?.[0]?.options ?? []) as SuggestOption[];
    return opts.map((o) => o.text).filter(Boolean);
  }

  async suggestStores(prefix: string): Promise<string[]> {
    const body = {
      size: 0,
      suggest: {
        s1: { prefix, completion: { field: "suggest", size: 8 } },
      },
    };
    const res = await this.os.search({ index: STORES_INDEX, body });
    const opts = (res.body?.suggest?.s1?.[0]?.options ?? []) as SuggestOption[];
    return opts.map((o) => o.text).filter(Boolean);
  }
}
