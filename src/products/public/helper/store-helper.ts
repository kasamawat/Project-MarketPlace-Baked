import { Types } from "mongoose";

export type StoreLean = {
  _id: Types.ObjectId;
  name: string;
  slug?: string;
  logoUrl?: string;
  coverUrl?: string;
  description?: string;
  status?: string;
};
