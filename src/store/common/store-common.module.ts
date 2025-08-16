import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Store, StoreSchema } from "../schemas/store.schema";
import { StoreResolverService } from "./store-resolver.service";

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Store.name, schema: StoreSchema }]),
  ],
  providers: [StoreResolverService],
  exports: [StoreResolverService], // 👈 ให้คนอื่นใช้งานได้
})
export class StoreCommonModule {}
