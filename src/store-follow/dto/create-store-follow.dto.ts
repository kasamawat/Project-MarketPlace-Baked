import { IsMongoId } from "class-validator";

export class CreateStoreFollowDto {
  @IsMongoId()
  storeId!: string;
}
