// Chạy migration lên Neon: npm run db:migrate (đọc DATABASE_URL từ .env.local)
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Không có .env.local thì dùng biến môi trường sẵn có
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Chưa có DATABASE_URL. Thêm vào .env.local rồi chạy lại.");
  process.exit(1);
}

await migrate(drizzle(url), { migrationsFolder: "./drizzle" });
console.log("Đã cập nhật schema database.");
