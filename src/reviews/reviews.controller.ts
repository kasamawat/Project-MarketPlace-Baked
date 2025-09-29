/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ReviewsService } from "./reviews.service";
import { CreateReviewDto } from "./dto/create-review.dto";
import { CurrentUser } from "src/common/current-user.decorator";
import { JwtPayload } from "src/auth/types/jwt-payload.interface";
import { FilesInterceptor } from "@nestjs/platform-express";
import { plainToInstance } from "class-transformer";
import { validateOrReject } from "class-validator";
import { memoryStorage } from "multer";

@Controller("reviews")
@UseGuards(AuthGuard("jwt"))
export class ReviewsController {
  constructor(private readonly svc: ReviewsService) {}

  @Post()
  @UseInterceptors(
    FilesInterceptor("images", 5, {
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024 }, // 2MB/รูป
    }),
  )
  async create(
    @CurrentUser() user: JwtPayload,
    @Body("dto") dtoStr: string,
    @Body() fallback?: any,
    @UploadedFiles() files: Express.Multer.File[] = [],
  ) {
    // แปลงค่าที่มาจาก form-data (string → number)
    const raw = dtoStr ? JSON.parse(dtoStr) : fallback;
    const dto = plainToInstance(CreateReviewDto, raw);
    await validateOrReject(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    // validate รูปแบบเบื้องต้น
    const invalids: string[] = [];
    const images: Express.Multer.File[] = [];
    for (let i = 0; i < (files?.length ?? 0); i++) {
      const f = files[i];
      if (!f) continue;
      if (!f.mimetype?.startsWith("image/")) {
        invalids.push(`images[${i}] must be an image`);
        continue;
      }
      images.push(f);
    }
    if (invalids.length) {
      throw new BadRequestException(invalids.join("; "));
    }

    return this.svc.create(dto, user);
  }

  // /reviews/by-product?productId=...&page=&limit=
  @Get("by-product")
  async byProduct(
    @Query("productId") productId: string,
    @Query("page") page = 1,
    @Query("limit") limit = 20,
  ) {
    return this.svc.listByProduct(productId, Number(page), Number(limit));
  }

  // /reviews/me?page=&limit=
  @Get("me")
  async myReviews(
    @CurrentUser() user: JwtPayload,
    @Query("page") page = 1,
    @Query("limit") limit = 20,
  ) {
    return this.svc.listMine(user, Number(page), Number(limit));
  }
}
