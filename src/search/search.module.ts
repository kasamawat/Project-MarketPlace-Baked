// search/search.module.ts
import { Module } from "@nestjs/common";
import { OpenSearchModule } from "./opensearch.module";
import { SearchService } from "./search.service";
import { SearchController } from "./search.controller";

@Module({
  imports: [OpenSearchModule],
  providers: [SearchService],
  controllers: [SearchController],
  exports: [SearchService],
})
export class SearchModule {}
