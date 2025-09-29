// search/os-types.ts
export interface TermsBucket {
  key: string;
  doc_count: number;
}
interface StatsAgg {
  count: number;
  min: number;
  max: number;
  avg: number;
  sum: number;
}
interface HistogramBucket {
  key: number;
  doc_count: number;
}
export interface ProductAggs {
  byCategory?: { buckets: TermsBucket[] };
  byBrand?: { buckets: TermsBucket[] };
  priceStats?: StatsAgg;
  ratingHist?: { buckets: HistogramBucket[] };
}
