import { Test, TestingModule } from "@nestjs/testing";
import { SkusService } from "./skus.service";

describe("SkusService", () => {
  let service: SkusService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SkusService],
    }).compile();

    service = module.get<SkusService>(SkusService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });
});
