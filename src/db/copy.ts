// Chép toàn bộ dữ liệu từ database này sang database khác (VD đổi Neon sang region khác).
// Chỉ đọc database nguồn. Database đích phải đã có bảng (chạy migration trước) và còn trống.
import { sql } from "drizzle-orm";
import type { DB } from "./index";
import { alerts, appSettings, planLevels, positions, transactions } from "./schema";

/** Thứ tự chép theo khóa ngoại: vị thế trước, rồi tới lệnh, nấc, cảnh báo */
const TABLES = [
  { name: "positions", table: positions, serial: true },
  { name: "plan_levels", table: planLevels, serial: true },
  { name: "transactions", table: transactions, serial: true },
  { name: "alerts", table: alerts, serial: true },
  { name: "app_settings", table: appSettings, serial: false },
] as const;

export type TableCount = { table: string; source: number; target: number };

async function countAll(db: DB): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const { name, table } of TABLES) {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
    out[name] = row.n;
  }
  return out;
}

/** Số dòng từng bảng ở nguồn và đích (dùng cho --dry-run và kiểm tra sau khi chép) */
export async function compareCounts(source: DB, target: DB): Promise<TableCount[]> {
  const [s, t] = await Promise.all([countAll(source), countAll(target)]);
  return TABLES.map(({ name }) => ({ table: name, source: s[name], target: t[name] }));
}

export async function copyDatabase(source: DB, target: DB): Promise<TableCount[]> {
  const before = await countAll(target);
  const filled = Object.entries(before).filter(([, n]) => n > 0);
  if (filled.length) {
    throw new Error(
      `Database đích đã có dữ liệu (${filled.map(([t, n]) => `${t}: ${n}`).join(", ")}). Dừng lại để không ghi đè.`,
    );
  }

  for (const { table } of TABLES) {
    const rows = await source.select().from(table);
    // Chia nhỏ để không vượt giới hạn tham số của một câu lệnh
    for (let i = 0; i < rows.length; i += 200) {
      await target.insert(table).values(rows.slice(i, i + 200) as never);
    }
  }

  // Giữ nguyên id khi chép nên phải đặt lại bộ đếm, nếu không mã thêm mới sẽ trùng id
  for (const { name, serial } of TABLES) {
    if (!serial) continue;
    await target.execute(
      sql.raw(
        `select setval(pg_get_serial_sequence('${name}', 'id'), coalesce((select max(id) from ${name}), 1), (select max(id) from ${name}) is not null)`,
      ),
    );
  }

  const counts = await compareCounts(source, target);
  const mismatch = counts.filter((c) => c.source !== c.target);
  if (mismatch.length) {
    throw new Error(`Số dòng không khớp sau khi chép: ${mismatch.map((c) => `${c.table} ${c.source}→${c.target}`).join(", ")}`);
  }
  return counts;
}
