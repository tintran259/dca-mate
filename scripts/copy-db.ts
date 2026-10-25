// Chép dữ liệu từ database cũ sang database mới (VD chuyển Neon từ Mỹ về Singapore).
//   SOURCE_DATABASE_URL="<cũ>" TARGET_DATABASE_URL="<mới>" npm run db:copy -- --dry-run   (chỉ đếm, không ghi)
//   SOURCE_DATABASE_URL="<cũ>" TARGET_DATABASE_URL="<mới>" npm run db:copy
// Chỉ đọc database cũ. Database mới được tạo bảng (migration) rồi chép vào; đã có dữ liệu thì dừng.
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { compareCounts, copyDatabase } from "../src/db/copy";
import type { DB } from "../src/db/index";
import * as schema from "../src/db/schema";

/** Chỉ in host, không in mật khẩu */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(URL không hợp lệ)";
  }
}

function printCounts(rows: { table: string; source: number; target: number }[]) {
  for (const r of rows) console.log(`  ${r.table.padEnd(13)} cũ: ${String(r.source).padStart(4)}   mới: ${String(r.target).padStart(4)}`);
}

// Bọc trong hàm async: dự án chạy dạng CommonJS nên không dùng được await ở cấp ngoài cùng
async function main() {
  const sourceUrl = process.env.SOURCE_DATABASE_URL;
  const targetUrl = process.env.TARGET_DATABASE_URL;
  const dryRun = process.argv.includes("--dry-run");
  if (!sourceUrl || !targetUrl) {
    console.error("Cần SOURCE_DATABASE_URL (database cũ) và TARGET_DATABASE_URL (database mới).");
    process.exit(1);
  }
  if (hostOf(sourceUrl) === hostOf(targetUrl)) {
    console.error("Database cũ và mới đang là một. Kiểm tra lại hai URL.");
    process.exit(1);
  }
  console.log(`Database cũ: ${hostOf(sourceUrl)}`);
  console.log(`Database mới: ${hostOf(targetUrl)}`);

  const source = drizzle(sourceUrl, { schema }) as unknown as DB;
  const target = drizzle(targetUrl, { schema }) as unknown as DB;

  console.log("Tạo bảng trên database mới (migration)…");
  if (!dryRun) await migrate(target as never, { migrationsFolder: "./drizzle" });
  else console.log("  (bỏ qua khi chạy thử)");

  if (dryRun) {
    // Database mới có thể chưa có bảng: chỉ đếm database cũ
    console.log("Chạy thử (--dry-run), không ghi gì. Số dòng ở database cũ:");
    printCounts((await compareCounts(source, source)).map((r) => ({ ...r, target: 0 })));
    return;
  }

  console.log("Chép dữ liệu…");
  const counts = await copyDatabase(source, target);
  console.log("Xong, số dòng khớp ở mọi bảng:");
  printCounts(counts);
}

main().catch((err) => {
  console.error("Chép dữ liệu lỗi:", err instanceof Error ? err.message : err);
  process.exit(1);
});
