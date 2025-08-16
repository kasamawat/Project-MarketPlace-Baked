import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { Store, StoreDocument } from "../schemas/store.schema";
import { StoreLean } from "src/products/public/helper/store-helper";

@Injectable()
export class StoreResolverService {
  constructor(
    @InjectModel(Store.name) private readonly storeModel: Model<StoreDocument>,
  ) {}

  /** คืนค่า store หรือ null (ไม่ throw) */
  async resolveByIdOrSlug(idOrSlug: string): Promise<StoreLean | null> {
    let store = await this.storeModel
      .findOne({ slug: idOrSlug })
      .select("_id name slug")
      .lean<StoreLean>()
      .exec();

    if (!store && Types.ObjectId.isValid(idOrSlug)) {
      store = await this.storeModel
        .findById(idOrSlug)
        .select("_id name slug")
        .lean<StoreLean>()
        .exec();
    }
    return store;
  }

  /** ถ้าไม่พบจะ throw NotFoundException ให้เลย */
  async getOrThrow(idOrSlug: string): Promise<StoreLean> {
    const store = await this.resolveByIdOrSlug(idOrSlug);
    if (!store) throw new NotFoundException("Store not found");
    return store;
  }
}
