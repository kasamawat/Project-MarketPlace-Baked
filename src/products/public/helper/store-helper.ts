import { Types } from "mongoose";

interface LogoImageDto {
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

export type StoreLean = {
  _id: Types.ObjectId;
  name: string;
  slug?: string;
  logoUrl?: string;
  coverUrl?: string;
  description?: string;
  status?: string;
  logo?: LogoImageDto;
};
