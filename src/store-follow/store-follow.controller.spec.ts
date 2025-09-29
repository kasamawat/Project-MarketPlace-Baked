import { Test, TestingModule } from "@nestjs/testing";
import { StoreFollowController } from "./store-follow.controller";
import { StoreFollowService } from "./store-follow.service";

describe("StoreFollowController", () => {
  let controller: StoreFollowController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StoreFollowController],
      providers: [StoreFollowService],
    }).compile();

    controller = module.get<StoreFollowController>(StoreFollowController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });
});
