/* eslint-disable @typescript-eslint/no-misused-promises */
import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { ConfirmChannel, ConsumeMessage, Options } from "amqplib";
import type {
  AmqpConnectionManager,
  ChannelWrapper,
} from "amqp-connection-manager";
import { Client } from "@opensearch-project/opensearch";

import { MQ_CONNECTION } from "../mq.tokens";
import {
  bindSearchTopology,
  SEARCH_QUEUES,
  SEARCH_RK,
  pickSearchRetryQueue,
  basePublishOpts,
} from "../mq.topology";
import {
  ProductIndexEvent,
  StoreIndexEvent,
} from "../../search/types/index.types";

const MAX_RETRIES = 5;
const PRODUCTS_INDEX = process.env.SEARCH_PRODUCTS_INDEX ?? "products_v1";
const STORES_INDEX = process.env.SEARCH_STORES_INDEX ?? "stores_v1";

function safeJsonParse<T = unknown>(txt: string): T {
  try {
    return JSON.parse(txt) as T;
  } catch {
    throw new Error("Invalid JSON");
  }
}

@Injectable()
export class SearchIndexConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SearchIndexConsumer.name);
  private channelWrapper: ChannelWrapper | null = null;
  private os: Client;

  constructor(
    @Inject(MQ_CONNECTION) private readonly conn: AmqpConnectionManager | null,
  ) {
    this.os = new Client({
      node: process.env.SEARCH_NODE!,
      auth: process.env.SEARCH_AUTH
        ? {
            username: process.env.SEARCH_AUTH.split(":")[0],
            password: process.env.SEARCH_AUTH.split(":")[1],
          }
        : undefined,
      ssl: { rejectUnauthorized: false }, // dev/test เท่านั้น
      requestTimeout: 10_000,
    });
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async onModuleInit() {
    if (!this.conn) {
      this.logger.warn("AMQP disabled. SearchIndexConsumer will not start.");
      return;
    }

    this.channelWrapper = this.conn.createChannel({
      json: true,
      setup: async (ch: ConfirmChannel) => {
        await bindSearchTopology(ch);
        await ch.prefetch(16);

        await ch.consume(
          SEARCH_QUEUES.MAIN,
          (msg) => msg && this.handleMessage(ch, msg),
          { noAck: false },
        );
      },
    });

    this.logger.log("SearchIndexConsumer is ready.");
  }

  private handleMessage = async (ch: ConfirmChannel, msg: ConsumeMessage) => {
    const { routingKey, deliveryTag } = msg.fields;
    const headers = msg.properties.headers ?? {};
    const messageId = String(
      msg.properties.messageId ?? `no-message-id:${deliveryTag}`,
    );
    const retryCount: number = (headers["x-retries"] as number) ?? 0;
    const bodyStr = msg.content.toString("utf8");

    try {
      switch (routingKey) {
        case SEARCH_RK.INDEX_PRODUCT: {
          const payload = safeJsonParse<ProductIndexEvent>(bodyStr);
          await this.indexProduct(payload);
          break;
        }
        case SEARCH_RK.DELETE_PRODUCT: {
          const payload = safeJsonParse<{ productId: string }>(bodyStr);
          await this.deleteById(PRODUCTS_INDEX, payload.productId);
          break;
        }
        case SEARCH_RK.INDEX_STORE: {
          const payload = safeJsonParse<StoreIndexEvent>(bodyStr);
          await this.indexStore(payload);
          break;
        }
        case SEARCH_RK.DELETE_STORE: {
          const payload = safeJsonParse<{ storeId: string }>(bodyStr);
          await this.deleteById(STORES_INDEX, payload.storeId);
          break;
        }
        default:
          this.logger.debug(`Unhandled routingKey: ${routingKey}`);
      }

      ch.ack(msg);
    } catch (err) {
      this.logger.error(
        `Search handler error on ${routingKey} [msgId=${messageId} try=${retryCount}]: ${(err as Error)?.message || err}`,
      );

      if (retryCount < MAX_RETRIES) {
        const retryQueue = pickSearchRetryQueue(retryCount);
        const opts: Options.Publish = basePublishOpts(messageId, {
          ...headers,
          "x-retries": retryCount + 1,
        });
        ch.sendToQueue(retryQueue, msg.content, opts); // ปล่อยให้ TTL พา message กลับเข้า MAIN
        ch.ack(msg); // ack ต้นฉบับ
      } else {
        ch.nack(msg, false, false); // ไป DLQ
      }
    }
  };

  // ---------- OS ops ----------

  private async indexProduct(p: ProductIndexEvent) {
    const inputs = [p.name, p.brand].filter(Boolean) as string[];
    const cover = p.cover?.url ? { url: p.cover.url } : undefined;

    const doc = {
      productId: p.productId,
      storeId: p.storeId,
      name: p.name,

      // fix field
      name_auto_th: p.name,
      name_auto_en: p.name,
      name_infix_th: p.name,
      name_infix_en: p.name,

      category: p.category,
      type: p.type,
      price: p.price ?? 0,
      brand: p.brand,
      rating: p.rating,
      soldCount: p.soldCount,
      ...(cover ? { cover } : {}),

      createdAt: p.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),

      suggest: { input: inputs },
    };

    await this.os.update({
      index: PRODUCTS_INDEX,
      id: p.productId,
      retry_on_conflict: 3,
      refresh: false,
      body: { doc, doc_as_upsert: true },
    });
  }

  private async indexStore(s: StoreIndexEvent) {
    const body = {
      ...s,
      name_auto: s.name,
      suggest: { input: [s.name].filter(Boolean) },
    };
    await this.os.index({
      index: STORES_INDEX,
      id: s.storeId,
      body,
      refresh: false,
    });
  }

  private async deleteById(index: string, id: string) {
    await this.os.delete({ index, id }).catch(() => null); // เผื่อไม่เจอ ไม่ต้อง fail งาน
  }

  async onModuleDestroy() {
    try {
      await this.channelWrapper?.close();
    } catch {
      /* empty */
    }
    this.logger.log("SearchIndexConsumer channel closed.");
  }
}
