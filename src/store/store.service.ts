import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Store } from "./store.schema";
import { Model } from "mongoose";
import { CreateStoreDto } from "./dto/create-store.dto";
import { JwtPayload } from "src/auth/types/jwt-payload.interface";

@Injectable()
export class StoreService {
  constructor(
    @InjectModel(Store.name) private readonly storeModel: Model<Store>,
  ) {}

  async createStore(dto: CreateStoreDto, payload: JwtPayload) {
    const store = new this.storeModel({
      ...dto,
      ownerId: payload.userId,
      status: "pending",
      createdAt: new Date(),
    });

    return await store.save();
  }
}
