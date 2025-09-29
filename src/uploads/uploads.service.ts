import { Injectable, OnModuleInit } from "@nestjs/common";
import {
  v2 as cloudinary,
  UploadApiOptions,
  UploadApiResponse,
} from "cloudinary";

/**
 * Service สำหรับอัปโหลด/จัดการไฟล์รูปบน Cloudinary
 * - รองรับอัปโหลดจาก Buffer (แนะนำให้ใช้ Multer memoryStorage)
 * - มี helper สำหรับ temp upload, rename (promote), destroy, และ build URL
 */
@Injectable()
export class CloudinaryService implements OnModuleInit {
  private readonly cloudName = process.env.CLOUDINARY_CLOUD_NAME!;
  private readonly apiKey = process.env.CLOUDINARY_API_KEY!;
  private readonly apiSecret = process.env.CLOUDINARY_API_SECRET!;

  onModuleInit() {
    if (!this.cloudName || !this.apiKey || !this.apiSecret) {
      throw new Error(
        "Missing Cloudinary env. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET",
      );
    }
    cloudinary.config({
      cloud_name: this.cloudName,
      api_key: this.apiKey,
      api_secret: this.apiSecret,
    });
  }

  /**
   * อัปโหลดจาก Buffer (ใช้กับ Multer memoryStorage)
   */
  uploadBuffer(
    fileBuffer: Buffer,
    options: UploadApiOptions = {},
  ): Promise<UploadApiResponse> {
    return new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { resource_type: "image", ...options },
        (err, res) => (err || !res ? reject(err) : resolve(res)),
      );
      stream.end(fileBuffer);
    });
  }

  /**
   * อัปโหลดรูปไปยังโฟลเดอร์ชั่วคราวของร้าน (สำหรับ CREATE ก่อน commit)
   * tag: ['temp', `store:${storeId}`]
   */
  uploadTempImage(
    buffer: Buffer,
    storeId: string,
    extra: UploadApiOptions = {},
  ) {
    const tags = Array.isArray(extra.tags) ? extra.tags : [];
    return this.uploadBuffer(buffer, {
      folder: `stores/${storeId}/products/tmp`,
      use_filename: true,
      unique_filename: true,
      tags: ["temp", `store:${storeId}`, ...tags],
      ...extra,
    });
  }

  /**
   * ย้าย asset จาก temp -> final (ใช้ public_id แบบไม่มี .ext)
   * ตัวอย่าง finalPublicId: stores/{storeId}/products/{productId}/cover
   */
  rename(fromPublicId: string, toPublicId: string, overwrite = true) {
    return cloudinary.uploader.rename(fromPublicId, toPublicId, { overwrite });
  }

  /**
   * ลบไฟล์เดี่ยวตาม public_id
   */
  destroy(publicId: string) {
    return cloudinary.uploader.destroy(publicId);
  }

  /**
   * ลบไฟล์แบบกลุ่มด้วย tag (ใช้กับ job cleanup สำหรับ temp)
   */
  deleteByTag(tag: string) {
    return cloudinary.api.delete_resources_by_tag(tag);
  }

  /**
   * สร้าง URL สำหรับเสิร์ฟรูป (พร้อมทรานส์ฟอร์มเริ่มต้น f_auto,q_auto)
   * ตัวอย่าง: buildDeliveryUrl('stores/xxx/products/yyy/cover', 'c_fill,w_800,h_800')
   */
  buildDeliveryUrl(publicId: string, transformation = "f_auto,q_auto") {
    return `https://res.cloudinary.com/${this.cloudName}/image/upload/${transformation}/${publicId}`;
  }
}
