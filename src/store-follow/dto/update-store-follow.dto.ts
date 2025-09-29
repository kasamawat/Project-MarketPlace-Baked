import { PartialType } from "@nestjs/swagger";
import { CreateStoreFollowDto } from "./create-store-follow.dto";

export class UpdateStoreFollowDto extends PartialType(CreateStoreFollowDto) {}
