import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// Cả Neon và PGlite đều dùng chung API truy vấn của Drizzle.
// Không dùng transaction tương tác vì driver neon-http không hỗ trợ.
export type DB = NeonHttpDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { dcaDb?: Promise<DB> };

async function createDb(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { drizzle } = await import("drizzle-orm/neon-http");
    return drizzle(url, { schema });
  }

  if (process.env.VERCEL) {
    throw new Error("Thiếu biến môi trường DATABASE_URL trên Vercel.");
  }

  // Chạy local khi chưa có Neon: Postgres nhúng (PGlite), dữ liệu lưu ở .data/
  const { mkdirSync } = await import("node:fs");
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dir = process.env.PGLITE_DIR ?? "./.data/pglite";
  mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return db as unknown as DB;
}

export function getDb(): Promise<DB> {
  // Giữ 1 kết nối duy nhất qua các lần hot reload trong lúc dev
  globalForDb.dcaDb ??= createDb().catch((err) => {
    globalForDb.dcaDb = undefined;
    throw err;
  });
  return globalForDb.dcaDb;
}

export { schema };
