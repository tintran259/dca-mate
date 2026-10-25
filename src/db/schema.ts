import {
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// Giá lưu theo đơn vị đồng (VD 25000), khối lượng theo cổ phiếu.

export const positions = pgTable("positions", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  exchange: text("exchange", { enum: ["HOSE", "HNX", "UPCOM"] }).notNull(),
  status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
  thesis: text("thesis"),
  // Vốn tối đa được rót vào mã này (đồng), null = không giới hạn
  maxCapital: integer("max_capital"),
  // Ngưỡng cắt lỗ cứng so với giá mua đầu, VD -30
  stopLossPct: doublePrecision("stop_loss_pct"),
  // Trailing stop: giảm X% từ đỉnh (khi đang lãi) thì nhắc bán
  trailingPct: doublePrecision("trailing_pct"),
  lastPrice: integer("last_price"),
  lastPriceAt: timestamp("last_price_at", { withTimezone: true }),
  peakPrice: integer("peak_price"),
  stopNotifiedAt: timestamp("stop_notified_at", { withTimezone: true }),
  trailNotifiedPeak: integer("trail_notified_peak"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const transactions = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    positionId: integer("position_id")
      .notNull()
      .references(() => positions.id, { onDelete: "cascade" }),
    side: text("side", { enum: ["buy", "sell"] }).notNull(),
    tradeDate: date("trade_date").notNull(),
    price: integer("price").notNull(),
    quantity: integer("quantity").notNull(),
    fee: integer("fee").notNull().default(0),
    tax: integer("tax").notNull().default(0),
    note: text("note"),
    // Nấc kế hoạch mà lệnh này thực hiện (null = lệnh ngoài kế hoạch)
    levelId: integer("level_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("transactions_position_idx").on(t.positionId)],
);

export const planLevels = pgTable(
  "plan_levels",
  {
    id: serial("id").primaryKey(),
    positionId: integer("position_id")
      .notNull()
      .references(() => positions.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["dca", "tp"] }).notNull(),
    // DCA: số âm (-7 = giảm 7%). Chốt lời: số dương (+10 = lãi 10% trên giá vốn)
    pct: doublePrecision("pct").notNull(),
    // DCA: số cổ phiếu mua thêm
    quantity: integer("quantity"),
    // Chốt lời: % khối lượng đang giữ sẽ bán
    sellPct: doublePrecision("sell_pct"),
    status: text("status", { enum: ["pending", "notified", "done", "skipped"] })
      .notNull()
      .default("pending"),
    // Giá khớp thực tế khi nấc được đánh dấu đã làm (mốc tính các nấc còn lại)
    filledPrice: integer("filled_price"),
    // Thứ tự trong chuỗi (cho phép chèn nấc vào giữa), cùng giá trị thì xếp theo id
    sortOrder: integer("sort_order").notNull().default(0),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("plan_levels_position_idx").on(t.positionId)],
);

export const alerts = pgTable(
  "alerts",
  {
    id: serial("id").primaryKey(),
    positionId: integer("position_id")
      .notNull()
      .references(() => positions.id, { onDelete: "cascade" }),
    levelId: integer("level_id").references(() => planLevels.id, { onDelete: "set null" }),
    kind: text("kind", { enum: ["dca", "tp", "stop", "trail"] }).notNull(),
    price: integer("price").notNull(),
    message: text("message").notNull(),
    status: text("status", { enum: ["new", "done", "skipped"] }).notNull().default("new"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("alerts_status_idx").on(t.status)],
);

// Cài đặt chung của app: 1 dòng duy nhất (id = 1)
export const appSettings = pgTable("app_settings", {
  id: integer("id").primaryKey().default(1),
  // Tỷ lệ phí của công ty chứng khoán, VD 0.0015 = 0,15%. null = dùng mặc định
  buyFeeRate: doublePrecision("buy_fee_rate"),
  sellFeeRate: doublePrecision("sell_fee_rate"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Position = typeof positions.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type PlanLevel = typeof planLevels.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type Exchange = Position["exchange"];
