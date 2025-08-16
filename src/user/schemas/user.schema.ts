// user.schema.ts
import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type UserDocument = User & Document;

@Schema()
export class User {
  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: true })
  username: string;

  @Prop({ required: true })
  password: string;

  @Prop()
  firstname: string;

  @Prop()
  lastname: string;

  @Prop({ default: "customer" })
  role: string;

  @Prop({ default: () => new Date() })
  createdAt: Date;

  @Prop()
  editedAt: Date;

  @Prop()
  gender: string;

  @Prop()
  dob: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
