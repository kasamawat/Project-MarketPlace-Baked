import { Injectable } from "@nestjs/common";
// import { InjectModel } from "@nestjs/mongoose";
// import { Model } from "mongoose";
// import { User, UserDocument } from "./schemas/user.schema";

@Injectable()
export class UserService {
  // constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}
  // async create(email: string, password: string): Promise<User> {
  //   const createdUser = new this.userModel({ email, password });
  //   return createdUser.save();
  // }
  // async findByEmail(email: string): Promise<User | null> {
  //   return this.userModel.findOne({ email }).exec();
  // }
}
