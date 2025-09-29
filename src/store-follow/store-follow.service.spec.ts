import { Test, TestingModule } from "@nestjs/testing";
import { StoreFollowService } from "./store-follow.service";

describe("StoreFollowService", () => {
  let service: StoreFollowService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StoreFollowService],
    }).compile();

    service = module.get<StoreFollowService>(StoreFollowService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });
});
