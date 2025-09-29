// search/opensearch.module.ts
import { Module } from "@nestjs/common";
import { Client } from "@opensearch-project/opensearch";

export const OPENSEARCH_CLIENT = "OPENSEARCH_CLIENT";

@Module({
  providers: [
    {
      provide: OPENSEARCH_CLIENT,
      useFactory: () => {
        const node = process.env.SEARCH_NODE!; // e.g. https://your-os-domain:443
        const auth = process.env.SEARCH_AUTH; // e.g. "user:pass" หรือใช้ IAM signer ภายนอก
        return new Client({
          node,
          auth: auth
            ? { username: auth.split(":")[0], password: auth.split(":")[1] }
            : undefined,
          ssl: { rejectUnauthorized: true },
          requestTimeout: 5000,
        });
      },
    },
  ],
  exports: [OPENSEARCH_CLIENT],
})
export class OpenSearchModule {}
