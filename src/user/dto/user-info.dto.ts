// dto/store-info.dto.ts
import { Expose } from "class-transformer";

interface AvatarImageDto {
  _id: string;
  role: string;
  order?: number;
  publicId: string;
  version?: number;
  width?: number;
  height?: number;
  format?: string;
  url?: string;
}

export class UserInfoDto {
  @Expose() email: string;
  @Expose() username: string;
  @Expose() password?: string;
  @Expose() firstname?: string;
  @Expose() lastname?: string;
  @Expose() role?: string;
  @Expose() createdAt?: Date;
  @Expose() editedAt?: Date;
  @Expose() gender?: string;
  @Expose() dob: Date;
  @Expose() avatarUrl?: string;
  @Expose() avatar?: AvatarImageDto;
}
