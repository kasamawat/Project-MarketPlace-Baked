import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import * as jwt from "jsonwebtoken";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { User, UserDocument } from "src/user/user.schema";
import { Request } from "express";
import { JwtPayload } from "./types/jwt-payload.interface";

@Injectable()
export class AuthService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async register({
    username,
    email,
    password,
  }: {
    username: string;
    email: string;
    password: string;
  }): Promise<{ message: string }> {
    if (!username || !email || !password) {
      throw new BadRequestException("Missing required fields");
    }

    const existingUser = await this.userModel.findOne({
      $or: [{ username }, { email }],
    });

    if (existingUser) {
      throw new ConflictException("Username or email already exists");
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new this.userModel({
      username,
      email,
      password: hashedPassword,
      role: "customer",
    });

    await newUser.save();

    return { message: "User created successfully" };
  }

  async login({
    identifier,
    password,
  }: {
    identifier: string;
    password: string;
  }) {
    const user = await this.userModel.findOne({
      $or: [{ email: identifier }, { phone: identifier }],
    });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const token = jwt.sign(
      { userId: user._id, username: user.username, email: user.email },
      process.env.JWT_SECRET!,
      {
        expiresIn: "7d",
      },
    );

    return { token };
  }

  async getProfile(payload: JwtPayload) {
    const user = await this.userModel.findOne({ _id: payload.userId }).lean();

    if (!user) {
      throw new NotFoundException("User not found");
    }

    return { user };
  }

  async update(
    payload: JwtPayload,
    updateData: Partial<User>,
  ): Promise<{ message: string }> {
    const result = await this.userModel.findByIdAndUpdate(
      payload.userId,
      {
        $set: {
          firstname: updateData.firstname,
          lastname: updateData.lastname,
          gender: updateData.gender,
          dob: updateData.dob,
          editedAt: new Date(),
        },
      },
      { new: true }, // ✅ return document หลังอัปเดต
    );

    if (!result) {
      throw new NotFoundException("User not found");
    }

    return { message: "Profile updated successfully" };
  }
}
