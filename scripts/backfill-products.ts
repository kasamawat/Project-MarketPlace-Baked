// scripts/backfill-products.ts
import mongoose, { Types } from "mongoose";
import { Client } from "@opensearch-project/opensearch";
import * as dotenv from "dotenv";
dotenv.config();

/** ---------- โมเดลจริงของคุณ ---------- */
interface ProductDoc {
  _id: any;
  storeId: any;
  name: string;
  type?: string;
  brand?: string;
  defaultPrice?: number;
  rating?: number;
  soldCount?: number;
  category?: string;
  createdAt?: Date;
  updatedAt?: Date;
  status: "draft" | "pending" | "published" | "unpublished" | "rejected";
  // ถ้ามีเก็บรูปใน product เอง
  cover?: { url?: string };
  thumbnail?: string;
}

// เป็นโมเดลหลวม ๆ — แนะนำเปลี่ยนเป็นโมเดลจริงของโปรเจกต์
const Product = mongoose.model<ProductDoc>(
  "Product",
  new mongoose.Schema({}, { strict: false }),
);

/** (ออปชัน) ถ้าคุณมี collection 'images' และอยากดึง cover ปัจจุบันจาก DB */
type ImageDoc = {
  _id: any;
  entityType: string;
  entityId: any;
  storeId?: any;
  role?: string; // 'Cover' | 'Gallery'
  url?: string;
  deletedAt?: Date;
};
const Image =
  mongoose.models.Image ||
  mongoose.model<ImageDoc>("Image", new mongoose.Schema({}, { strict: false }));

const INDEX = process.env.SEARCH_PRODUCTS_INDEX ?? "products_v1";

function mapProductForIndex(p: ProductDoc, coverUrl?: string) {
  const productId = String(p._id);
  const inputs = [p.name, p.brand].filter(Boolean) as string[];

  const doc: Record<string, any> = {
    productId,
    storeId: String(p.storeId),
    name: p.name,

    // fix field
    name_auto_th: p.name,
    name_auto_en: p.name,
    name_infix_th: p.name,
    name_infix_en: p.name,

    category: p.category,
    type: p.type,
    price: p.defaultPrice ?? 0,
    brand: p.brand,
    rating: p.rating ?? 0,
    soldCount: p.soldCount ?? 0,

    // timestamps
    createdAt: (p.createdAt ?? new Date()).toISOString(),
    updatedAt: new Date().toISOString(),

    // completion suggest
    suggest: { input: inputs },
  };

  // cover.url จากพารามิเตอร์ก่อน ถ้าไม่มีก็ลองจาก product.cover/thumbnail
  const url =
    coverUrl ||
    p.cover?.url ||
    p.thumbnail || // เผื่อช่วงเปลี่ยนผ่านจาก thumbnail
    undefined;

  if (url) doc.cover = { url };

  return doc;
}

async function findCoverUrlFromImages(
  productId: string,
): Promise<string | undefined> {
  // ปรับ filter ให้ตรงกับของจริงในระบบคุณ
  const doc = await Image.findOne({
    entityType: "product",
    entityId: new Types.ObjectId(productId),
    role: "cover",
  })
    .select({ url: 1 })
    .lean<{ url: string }>();
  return doc?.url || undefined;
}

async function main() {
  // 1) connect DB
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is not set");
  }
  await mongoose.connect(process.env.MONGODB_URI);

  // 2) connect OpenSearch
  if (!process.env.SEARCH_NODE) {
    throw new Error("SEARCH_NODE is not set");
  }
  const os = new Client({
    node: process.env.SEARCH_NODE, // http://localhost:9200 | https://...
    auth: process.env.SEARCH_AUTH
      ? {
          username: process.env.SEARCH_AUTH.split(":")[0],
          password: process.env.SEARCH_AUTH.split(":")[1],
        }
      : undefined,
    ssl: { rejectUnauthorized: false }, // dev เท่านั้น
    requestTimeout: 30000,
  });

  // 3) backfill เฉพาะ published
  const BATCH = 1000;
  const cursor = Product.find({ status: "published" }, null, {
    lean: true,
  }).cursor();

  let bulk: any[] = [];
  let count = 0;

  for await (const p of cursor) {
    const productId = String(p._id);

    // (ออปชัน) ดึง cover ปัจจุบันจาก collection images
    // ปิดได้ถ้าไม่ต้องการ round-trip DB
    const coverUrl = await findCoverUrlFromImages(productId).catch(
      () => undefined,
    );

    const doc = mapProductForIndex(p, coverUrl);

    // ใช้ update + doc_as_upsert: true ให้เหมือน consumer
    bulk.push({ update: { _index: INDEX, _id: productId } });
    bulk.push({ doc, doc_as_upsert: true });

    if (bulk.length >= BATCH * 2) {
      const res = await os.bulk({ refresh: false, body: bulk });
      if (res.body?.errors) {
        const items = res.body.items || [];
        items.forEach((it) => {
          const k = Object.keys(it)[0];
          if (it[k]?.error) {
            console.error("Bulk error:", it[k].error);
          }
        });
      }
      count += BATCH;
      console.log(`Indexed ${count} products...`);
      bulk = [];
    }
  }

  if (bulk.length) {
    const res = await os.bulk({ refresh: true, body: bulk }); // ชุดสุดท้าย refresh ให้เห็นผลทันที
    const n = Math.floor(bulk.length / 2);
    count += n;
    if (res.body?.errors) {
      const items = res.body.items || [];
      items.forEach((it) => {
        const k = Object.keys(it)[0];
        if (it[k]?.error) console.error("Bulk error:", it[k].error);
      });
    }
  }

  console.log(`✅ Done. Total indexed (approx): ${count}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
