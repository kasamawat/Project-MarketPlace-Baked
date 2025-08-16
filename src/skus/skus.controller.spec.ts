import { Test, TestingModule } from "@nestjs/testing";
import { SkusController } from "./skus.controller";

describe("SkusController", () => {
  let controller: SkusController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SkusController],
    }).compile();

    controller = module.get<SkusController>(SkusController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });
});
