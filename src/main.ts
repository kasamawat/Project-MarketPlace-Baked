import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import * as cookieParser from "cookie-parser";
import * as bodyParser from "body-parser";

async function bootstrap() {
  // ❗ ปิด body parser ของ Nest เพื่อคุมลำดับ middleware เอง
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  app.use(cookieParser());
  app.enableCors({
    origin: "http://localhost:3000",
    credentials: true,
  });

  // 1) เส้นทาง Webhook: ต้องเป็น RAW BUFFER เท่านั้น
  // app.use("/payments/webhook", bodyParser.raw({ type: "application/json" }));
  app.use("/webhooks/payment", bodyParser.raw({ type: "application/json" }));
  app.use(
    "/webhooks/carriers/:carrierCode",
    bodyParser.raw({ type: "application/json" }),
  );

  // 2) เส้นทางอื่น: ค่อยใส่ JSON/URLENCODED ตามปกติ
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));

  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
