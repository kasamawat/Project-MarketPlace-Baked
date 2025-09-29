// search/types.ts
export type ProductHit = {
  productId: string;
  storeId?: string;
  name: string;
  category: string;
  type: string;
  price: number;
  cover?: { url: string };
  rating?: number;
  soldCount?: number;
};

export type StoreHit = {
  storeId: string;
  name: string;
  bannerUrl?: string;
  province?: string;
  rating?: number;
};

export type ProductFacets = {
  categories?: { key: string; doc_count: number }[];
  brands?: { key: string; doc_count: number }[];
  priceStats?: {
    min: number;
    max: number;
    avg: number;
    count: number;
    sum: number;
  };
  ratingHist?: { key: number; doc_count: number }[];
};

export type ProductFilters = {
  category?: string[];
  brand?: string[];
  priceMin?: number;
  priceMax?: number;
  ratingMin?: number;
  available?: boolean;
};

export type SearchProductsResponse = {
  items: ProductHit[];
  total: number;
  facets?: ProductFacets;
  page: number;
  limit: number;
};

export type SearchStoresResponse = {
  items: StoreHit[];
  total: number;
  page: number;
  limit: number;
};

export type SuggestOption = { text: string };

export interface ProductDoc {
  productId: string;
  name: string;
  price: number;
  thumbnail?: string;
  rating?: number;
  soldCount?: number;
  storeId?: string;
  createdAt?: string;
}

export interface StoreDoc {
  storeId: string;
  name: string;
  bannerUrl?: string;
  province?: string;
  rating?: number;
  follower?: number;
  createdAt?: string;
}
