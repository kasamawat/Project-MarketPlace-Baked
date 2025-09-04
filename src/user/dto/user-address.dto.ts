export type AddressInfoResponseDto = {
  _id?: string;
  name?: string;
  phone?: string;
  line1?: string;
  line2?: string;
  district?: string; // อำเภอ/เขต
  subDistrict?: string; // ตำบล/แขวง
  province?: string;
  postalCode?: string;
  country?: string;
  note?: string; // โน้ตจากผู้ซื้อ
  isDefault?: boolean; // สถานะ default (optional ฝั่ง FE)
};
