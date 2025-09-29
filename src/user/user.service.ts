import { Injectable, NotFoundException } from "@nestjs/common";
import { User, UserDocument } from "./schemas/user.schema";
import { Model, Types } from "mongoose";
import { InjectModel } from "@nestjs/mongoose";
import { JwtPayload } from "src/auth/types/jwt-payload.interface";
import { AddressInfoResponseDto } from "./dto/user-address.dto";
import { AddressInfoDto } from "./dto/address-info.dto";
import { UpdateUserInfoDto } from "./dto/user-update-info.dto";
import { ImagesService } from "src/images/images.service";
import { OutboxService } from "src/outbox/outbox.service";
import { CloudinaryService } from "src/uploads/uploads.service";
import { Image, ImageDocument } from "src/images/schemas/image.schema";
import { ImageEntityType, ImageRole } from "src/images/image.enums";
import { ImagesLeanRaw } from "src/products/dto/response-product.dto";
import { plainToInstance } from "class-transformer";
import { UserInfoDto } from "./dto/user-info.dto";

@Injectable()
export class UserService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Image.name)
    private readonly imageModel: Model<ImageDocument>,

    private readonly cloud: CloudinaryService,
    private readonly imagesService: ImagesService,
    private readonly outboxService: OutboxService,
  ) {}

  async getProfile(payload: JwtPayload): Promise<UserInfoDto> {
    const userIdObj = new Types.ObjectId(payload.userId);

    const [user, avatarDoc] = await Promise.all([
      this.userModel.findOne({ _id: userIdObj }).lean(),
      this.imageModel
        .findOne({
          entityType: ImageEntityType.User,
          entityId: userIdObj,
          role: ImageRole.Avatar,
          // $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
        })
        .select(
          "_id role order publicId version width height format url createdAt",
        )
        .lean<ImagesLeanRaw>()
        .exec(),
    ]);
    if (!user) {
      throw new NotFoundException("User not found");
    }

    const dto = plainToInstance(UserInfoDto, user, {
      excludeExtraneousValues: true,
    });

    if (avatarDoc?.url) dto.avatarUrl = avatarDoc.url;

    if (avatarDoc) {
      dto.avatar = {
        _id: String(avatarDoc._id),
        role: avatarDoc.role,
        order: avatarDoc.order,
        publicId: avatarDoc.publicId,
        version: avatarDoc.version,
        width: avatarDoc.width,
        height: avatarDoc.height,
        format: avatarDoc.format,
        url: avatarDoc.url,
      };
    }

    return dto;
  }

  async updateUserInfo(
    payload: JwtPayload,
    updateData: UpdateUserInfoDto,
    avatar?: Express.Multer.File,
  ): Promise<UserInfoDto & { ok: true }> {
    const userIdObj = new Types.ObjectId(payload.userId);

    const setPatch: Record<string, any> = { editedAt: new Date() };
    if (updateData.firstname !== undefined)
      setPatch.firstname = updateData.firstname;
    if (updateData.lastname !== undefined)
      setPatch.lastname = updateData.lastname;
    if (updateData.gender !== undefined) setPatch.gender = updateData.gender;
    if (updateData.dob !== undefined) setPatch.dob = updateData.dob;

    const result = await this.userModel.findByIdAndUpdate(
      userIdObj,
      { $set: setPatch },
      { new: true },
    );

    if (!result) {
      throw new NotFoundException("User not found");
    }

    if (avatar) {
      const prevPublicId = `users/${String(payload.userId)}/avatar`;

      // 1) upload -> temp
      const temp = await this.cloud.uploadTempImage(
        avatar.buffer,
        String(payload.userId),
      );

      // 2) rename temp -> final (ทับของเดิมด้วย public_id เดิม)
      await this.cloud.rename(temp.public_id, prevPublicId);

      // 3) final URL พร้อม version ใหม่
      const finalUrl = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/f_auto,q_auto/v${temp.version}/${prevPublicId}`;

      // 4) อัปเดต images table (ลบ metadata เก่า role:Logo ทิ้ง แล้ว attach ใหม่)
      await this.imagesService
        .detachByEntityRole(
          ImageEntityType.User,
          String(payload.userId),
          ImageRole.Avatar,
          payload,
          { deleteOnCloud: false },
        )
        .catch(() => {});

      await this.imagesService.attach(
        {
          entityType: ImageEntityType.User,
          entityId: String(payload.userId),
          role: ImageRole.Avatar,
          publicId: prevPublicId,
          url: finalUrl,
          version: temp.version,
          width: temp.width,
          height: temp.height,
          format: temp.format,
          bytes: temp.bytes,
        },
        payload,
      );
    }

    const proFile = await this.getProfile(payload);
    return { ...proFile, ok: true };
  }

  async getAddresses(payload: JwtPayload): Promise<AddressInfoResponseDto[]> {
    // ดึงเฉพาะฟิลด์ addresses และตัด _id ของ user ออก
    const doc = await this.userModel
      .findById(payload.userId)
      .select({ addresses: 1, _id: 0 })
      .lean()
      .exec();

    if (!doc) throw new NotFoundException("User not found");

    const addrs = (doc.addresses ?? []) as Array<{
      _id: Types.ObjectId;
      name?: string;
      phone?: string;
      line1?: string;
      line2?: string;
      district?: string;
      subDistrict?: string;
      province?: string;
      postalCode?: string;
      country?: string;
      note?: string;
      isDefault?: boolean;
    }>;

    // map -> DTO (+ แปลง _id เป็น string)
    const result: AddressInfoResponseDto[] = addrs.map((a) => ({
      _id: String(a._id),
      name: a.name,
      phone: a.phone,
      line1: a.line1,
      line2: a.line2,
      district: a.district,
      subDistrict: a.subDistrict,
      province: a.province,
      postalCode: a.postalCode,
      country: a.country,
      note: a.note,
      isDefault: a.isDefault ?? false,
    }));

    // (ออปชั่น) จัดเรียงให้ default ขึ้นก่อน
    result.sort((x, y) => Number(y.isDefault ?? 0) - Number(x.isDefault ?? 0));

    return result;
  }

  async addAddress(
    payload: JwtPayload,
    dto: AddressInfoDto,
  ): Promise<AddressInfoResponseDto> {
    const user = await this.userModel.findById(payload.userId).exec();
    if (!user) throw new NotFoundException("User not found");

    // ถ้ามี isDefault=true → clear default address อื่น ๆ ก่อน
    if (dto.isDefault) {
      user.addresses.forEach((a) => {
        a.isDefault = false;
      });
    }

    user.addresses.push(dto);
    await user.save();

    const newAddress = user.addresses[user.addresses.length - 1];

    return newAddress;
  }

  async updateAddress(
    payload: JwtPayload,
    addressId: string,
    dto: AddressInfoDto,
  ): Promise<AddressInfoResponseDto> {
    const userId = new Types.ObjectId(payload.userId);
    const addrId = new Types.ObjectId(addressId);

    // สร้าง $set เฉพาะฟิลด์ที่มีมา
    const prefix = "addresses.$";
    const set: Record<string, any> = {};
    const fields: (keyof AddressInfoDto)[] = [
      "name",
      "phone",
      "line1",
      "line2",
      "district",
      "subDistrict",
      "province",
      "postalCode",
      "country",
      "note",
    ];
    for (const k of fields) {
      if (dto[k] !== undefined) set[`${prefix}.${k}`] = dto[k];
    }
    if (dto.isDefault !== undefined) set[`${prefix}.isDefault`] = dto.isDefault;

    // ถ้า isDefault=true → เคลียร์ตัวอื่นก่อน (อะตอมมิกพอสำหรับ use-case นี้)
    if (dto.isDefault === true) {
      await this.userModel
        .updateOne(
          { _id: userId },
          { $set: { "addresses.$[].isDefault": false } },
        )
        .exec();
    }

    const { matchedCount } = await this.userModel
      .updateOne({ _id: userId, "addresses._id": addrId }, { $set: set })
      .exec();

    if (!matchedCount) throw new NotFoundException("Address not found");

    // ดึง address ที่อัปเดตมาให้ FE
    const doc = await this.userModel
      .findOne(
        { _id: userId },
        { addresses: { $elemMatch: { _id: addrId } }, _id: 0 },
      )
      .lean();

    if (!doc?.addresses?.[0]) throw new NotFoundException("Address not found");
    return doc.addresses[0];
  }

  async setDefaultAddress(
    payload: JwtPayload,
    addressId: string,
  ): Promise<{ id: string }> {
    const userId = new Types.ObjectId(payload.userId);
    const addrId = new Types.ObjectId(addressId);

    // เคลียร์ทั้งหมดให้ false
    await this.userModel
      .updateOne(
        { _id: userId },
        { $set: { "addresses.$[].isDefault": false } },
      )
      .exec();

    // ตั้งตัวที่เลือกให้ true (positional operator)
    const res = await this.userModel
      .updateOne(
        { _id: userId, "addresses._id": addrId },
        { $set: { "addresses.$.isDefault": true } },
      )
      .exec();

    if (res.matchedCount === 0) {
      throw new NotFoundException("Address not found");
    }

    return { id: addressId };
  }

  async deleteAddress(payload: JwtPayload, addressId: string) {
    const userId = new Types.ObjectId(payload.userId);
    const addrId = new Types.ObjectId(addressId);

    const res = await this.userModel.updateOne(
      { _id: userId, "addresses._id": addrId },
      { $pull: { addresses: { _id: addrId } } },
    );

    if (res.modifiedCount === 0) {
      throw new NotFoundException("Address not found");
    }

    // res.modifiedCount > 0 แปลว่ามี address ถูกลบจริง
    return res.modifiedCount > 0;
  }
}
