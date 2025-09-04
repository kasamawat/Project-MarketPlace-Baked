// shared/address.schema.ts
import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";

@Schema({ _id: true }) // _id: true จะได้ id ของแต่ละ address เอาไว้แก้/ลบ
export class AddressInfo {
  @Prop() name?: string;
  @Prop() phone?: string;
  @Prop() line1?: string;
  @Prop() line2?: string;
  @Prop() district?: string; // อำเภอ/เขต
  @Prop() subDistrict?: string; // ตำบล/แขวง
  @Prop() province?: string;
  @Prop() postalCode?: string;
  @Prop() country?: string;
  @Prop() note?: string; // เช่น ฝากไว้หน้าบ้าน
  @Prop({ default: false }) isDefault?: boolean;
}
export const AddressInfoSchema = SchemaFactory.createForClass(AddressInfo);
