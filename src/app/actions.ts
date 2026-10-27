"use server";

import { and, eq, inArray, ne, notInArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { alerts, planLevels, positions, transactions, type Exchange } from "@/db/schema";
import {
  SESSION_COOKIE,
  SESSION_DAYS,
  checkPassword,
  createSessionToken,
  verifySessionToken,
} from "@/lib/auth";
import { classifyTrade, computeHolding, planHints } from "@/lib/calc";
import { applyManualPrice, runPriceCheck } from "@/lib/check";
import { getFeeRates, saveFeeRates } from "@/lib/fees";
import { formatPrice, todayVN } from "@/lib/format";
import { getLevelPlanPrice, orderLevels } from "@/lib/data";
import { EXCHANGES, feePctError } from "@/lib/market";
import { parseDecimalInput, parseIntInput } from "@/lib/parse";
import { fetchPrices, lookupSymbol } from "@/lib/prices";
import { dcaLevelErrors, firstError, priceError, tpLevelErrors, tradeErrors } from "@/lib/validate";
import { sendTelegram } from "@/lib/telegram";

export type ActionState = { error?: string; ok?: string } | null;

async function requireAuth() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await verifySessionToken(token))) redirect("/login");
}

function refreshAll() {
  revalidatePath("/", "layout");
}

// ---------- Đăng nhập ----------

export async function login(_: ActionState, formData: FormData): Promise<ActionState> {
  const password = String(formData.get("password") ?? "");
  if (!process.env.APP_PASSWORD) return { error: "Chưa cấu hình APP_PASSWORD trên server." };
  if (!(await checkPassword(password))) return { error: "Mật khẩu không đúng." };

  (await cookies()).set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
  const next = String(formData.get("next") ?? "/");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

// ---------- Vị thế ----------

export type LevelDraft = {
  id?: number;
  kind: "dca" | "tp";
  pct: number;
  quantity?: number | null;
  sellPct?: number | null;
};

function parseLevels(raw: FormDataEntryValue | null): LevelDraft[] | string {
  let data: unknown;
  try {
    data = JSON.parse(String(raw ?? "[]"));
  } catch {
    return "Dữ liệu kế hoạch không hợp lệ.";
  }
  if (!Array.isArray(data)) return "Dữ liệu kế hoạch không hợp lệ.";
  const levels: LevelDraft[] = [];
  for (const item of data as LevelDraft[]) {
    const pct = Number(item.pct);
    if (!Number.isFinite(pct) || pct === 0) continue;
    if (item.kind === "dca") {
      if (pct > 0) return "Nấc DCA phải là mức giảm (số âm), VD -7.";
      const qty = Number(item.quantity);
      const dcaError = firstError(dcaLevelErrors(-pct, qty));
      if (dcaError) return `Nấc DCA ${pct}%: ${dcaError}`;
      if (!Number.isInteger(qty) || qty <= 0 || qty % 100 !== 0)
        return `Khối lượng nấc DCA ${pct}% phải là bội số của 100.`;
      levels.push({ id: item.id, kind: "dca", pct, quantity: qty });
    } else if (item.kind === "tp") {
      if (pct < 0) return "Nấc chốt lời phải là mức lãi (số dương), VD +10.";
      const sellPct = Number(item.sellPct);
      const tpError = firstError(tpLevelErrors(pct, sellPct));
      if (tpError) return `Nấc chốt lời +${pct}%: ${tpError}`;
      levels.push({ id: item.id, kind: "tp", pct, sellPct });
    }
  }
  return levels;
}

type TradeInput = {
  tradeDate: string;
  price: number;
  quantity: number;
  fee: number;
  tax: number;
  note: string | null;
};

function parseTrade(formData: FormData): TradeInput | string {
  // Ghi lệnh nhanh từ nút "Đã làm" không gửi ngày → mặc định hôm nay
  const tradeDate = String(formData.get("tradeDate") || todayVN());
  const price = parseIntInput(formData.get("price"));
  const quantity = parseIntInput(formData.get("quantity"));
  const fee = parseIntInput(formData.get("fee")) ?? 0;
  const tax = parseIntInput(formData.get("tax")) ?? 0;
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) return "Chọn ngày giao dịch.";
  if (tradeDate > todayVN()) return "Ngày giao dịch không được ở tương lai.";
  if (!price || price <= 0) return "Nhập giá khớp lệnh (đồng), VD 25.000.";
  if (price < 1_000) return "Giá tính theo đồng, VD 25.000 chứ không phải 25.";
  if (!quantity || quantity <= 0) return "Nhập khối lượng.";
  if (fee < 0 || tax < 0) return "Phí và thuế không được âm.";
  return { tradeDate, price, quantity, fee, tax, note };
}

export async function createPosition(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireAuth();
  const symbol = String(formData.get("symbol") ?? "").trim().toUpperCase();
  const exchange = String(formData.get("exchange") ?? "") as Exchange;
  const thesis = String(formData.get("thesis") ?? "").trim() || null;
  if (!/^[A-Z0-9]{3,10}$/.test(symbol)) return { error: "Mã cổ phiếu không hợp lệ, VD HPG." };
  if (!EXCHANGES.includes(exchange)) return { error: "Chọn sàn giao dịch." };
  const trade = parseTrade(formData);
  if (typeof trade === "string") return { error: trade };
  const tradeError = firstError(tradeErrors({ exchange, side: "buy", ...trade, tax: null }));
  if (tradeError) return { error: tradeError };
  const levels = parseLevels(formData.get("levels"));
  if (typeof levels === "string") return { error: levels };

  const db = await getDb();
  const [existing] = await db
    .select({ id: positions.id })
    .from(positions)
    .where(and(eq(positions.symbol, symbol), eq(positions.status, "open")));
  if (existing) {
    return { error: `Bạn đã có vị thế ${symbol} đang mở. Hãy vào mã đó và bấm "Thêm lệnh".` };
  }

  // Giá thị trường lúc tạo (không phải giá mua), nguồn giá lỗi thì tạm dùng giá mua
  const marketPrice = (await fetchPrices([symbol])).prices.get(symbol);
  const [position] = await db
    .insert(positions)
    .values({
      symbol,
      exchange,
      thesis,
      lastPrice: marketPrice ?? trade.price,
      lastPriceAt: marketPrice ? new Date() : null,
      peakPrice: marketPrice ?? trade.price,
    })
    .returning({ id: positions.id });
  await db.insert(transactions).values({ positionId: position.id, side: "buy", ...trade });
  if (levels.length > 0) {
    await db.insert(planLevels).values(
      levels.map((l, i) => ({
        positionId: position.id,
        kind: l.kind,
        pct: l.pct,
        quantity: l.quantity ?? null,
        sellPct: l.sellPct ?? null,
        sortOrder: i,
      })),
    );
  }
  refreshAll();
  redirect(`/positions/${position.id}?created=1`);
}

export async function savePlan(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireAuth();
  const positionId = parseIntInput(formData.get("positionId"));
  if (!positionId) return { error: "Thiếu mã vị thế." };
  const levels = parseLevels(formData.get("levels"));
  if (typeof levels === "string") return { error: levels };

  const db = await getDb();
  const [current] = await db.select({ id: positions.id }).from(positions).where(eq(positions.id, positionId));
  if (!current) return { error: "Không tìm thấy vị thế." };

  const keepIds = levels.flatMap((l) => (l.id ? [l.id] : []));
  await db
    .delete(planLevels)
    .where(
      and(
        eq(planLevels.positionId, positionId),
        ne(planLevels.status, "done"),
        ...(keepIds.length ? [notInArray(planLevels.id, keepIds)] : []),
      ),
    );

  const existing = keepIds.length
    ? await db.select().from(planLevels).where(inArray(planLevels.id, keepIds))
    : [];
  for (const [sortOrder, l] of levels.entries()) {
    const prev = l.id ? existing.find((e) => e.id === l.id && e.positionId === positionId) : undefined;
    if (prev?.status === "done") {
      await db.update(planLevels).set({ sortOrder }).where(eq(planLevels.id, prev.id));
    } else if (prev) {
      const changed =
        prev.pct !== l.pct || prev.quantity !== (l.quantity ?? null) || prev.sellPct !== (l.sellPct ?? null);
      await db
        .update(planLevels)
        .set({
          pct: l.pct,
          quantity: l.quantity ?? null,
          sellPct: l.sellPct ?? null,
          sortOrder,
          // Sửa mức của nấc đã nhắc thì đưa về trạng thái chờ
          ...(changed && prev.status === "notified" && { status: "pending" as const, notifiedAt: null }),
        })
        .where(eq(planLevels.id, prev.id));
    } else {
      await db.insert(planLevels).values({
        positionId,
        kind: l.kind,
        pct: l.pct,
        quantity: l.quantity ?? null,
        sellPct: l.sellPct ?? null,
        sortOrder,
      });
    }
  }
  refreshAll();
  return { ok: "Đã lưu kế hoạch." };
}

export async function updateThesis(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireAuth();
  const positionId = parseIntInput(formData.get("positionId"));
  if (!positionId) return { error: "Thiếu mã vị thế." };
  const thesis = String(formData.get("thesis") ?? "").trim() || null;
  const db = await getDb();
  await db.update(positions).set({ thesis }).where(eq(positions.id, positionId));
  refreshAll();
  return { ok: "Đã lưu ghi chú." };
}

// ---------- Lệnh ----------

export async function addTransaction(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireAuth();
  const positionId = parseIntInput(formData.get("positionId"));
  const side = formData.get("side") === "sell" ? "sell" : "buy";
  const formLevelId = parseIntInput(formData.get("levelId"));
  const formAlertId = parseIntInput(formData.get("alertId"));
  if (!positionId) return { error: "Thiếu mã vị thế." };
  const trade = parseTrade(formData);
  if (typeof trade === "string") return { error: trade };

  const db = await getDb();
  const [position] = await db.select().from(positions).where(eq(positions.id, positionId));
  if (!position) return { error: "Không tìm thấy vị thế." };
  // Nấc và cảnh báo gửi lên từ form phải thuộc đúng vị thế này
  const [level] = formLevelId
    ? await db.select({ id: planLevels.id }).from(planLevels).where(and(eq(planLevels.id, formLevelId), eq(planLevels.positionId, positionId)))
    : [];
  const [alert] = formAlertId
    ? await db.select({ id: alerts.id }).from(alerts).where(and(eq(alerts.id, formAlertId), eq(alerts.positionId, positionId)))
    : [];
  const levelId = level?.id ?? null;
  const alertId = alert?.id ?? null;
  const txs = await db.select().from(transactions).where(eq(transactions.positionId, positionId));
  const holding = computeHolding(txs);
  const tradeError = firstError(
    tradeErrors({ exchange: position.exchange, side, ...trade, tax: side === "sell" ? trade.tax : null, holdingQty: holding.quantity }),
  );
  if (tradeError) return { error: tradeError };

  // Lệnh tay không gắn nấc: đối chiếu với kế hoạch
  //  - khớp nấc đang chờ → tự đánh dấu nấc đó đã làm
  //  - lệch kế hoạch và người dùng đồng ý → thêm thành nấc mới (đã làm) trước nấc đang chờ
  let doneLevelId: number | null = levelId;
  // Nấc mà lệnh này thực hiện, lưu vào lệnh để lịch sử ghi "Done theo kế hoạch"
  let planLevelId: number | null = levelId;
  let planNote = "";
  if (!levelId) {
    const levels = orderLevels(await db.select().from(planLevels).where(eq(planLevels.positionId, positionId)));
    const kind = side === "buy" ? "dca" : "tp";
    const label = side === "buy" ? "DCA" : "chốt lời";
    const fit = classifyTrade(planHints(position, holding, levels, await getFeeRates()), side, trade.price);
    if (fit.kind === "match") {
      doneLevelId = fit.level.levelId;
      planLevelId = fit.level.levelId;
      planNote = ` Đã tự đánh dấu nấc ${label} ${fit.level.levelNo} là đã làm.`;
    } else if (fit.kind === "insert" && formData.get("insertLevel") === "1") {
      // Chèn nấc mới vào vị trí của nấc đang chờ (hoặc cuối chuỗi), các nấc từ đó lùi xuống 1 bậc
      const at = fit.before ? levels.findIndex((l) => l.id === fit.before!.levelId) : levels.length;
      for (const [i, l] of levels.entries()) {
        const order = i < at ? i : i + 1;
        if (l.sortOrder !== order) await db.update(planLevels).set({ sortOrder: order }).where(eq(planLevels.id, l.id));
      }
      const [inserted] = await db.insert(planLevels).values({
        positionId,
        kind,
        pct: fit.pct,
        quantity: side === "buy" ? trade.quantity : null,
        // Chốt lời: % bán tính trên số cổ đang giữ lúc bán
        sellPct: side === "sell" ? Math.min(100, Math.round((trade.quantity / holding.quantity) * 1000) / 10) : null,
        status: "done",
        filledPrice: trade.price,
        sortOrder: at,
      }).returning({ id: planLevels.id });
      planLevelId = inserted.id;
      planNote =
        ` Đã thêm nấc ${label} mới (${fit.pct > 0 ? "+" : ""}${String(fit.pct).replace(".", ",")}%)` +
        (fit.before ? ` vào vị trí nấc ${fit.before.levelNo}, các nấc sau lùi xuống 1 bậc.` : " vào cuối chuỗi.");
    }
  }

  await db.insert(transactions).values({ positionId, side, ...trade, levelId: planLevelId });

  // Thực hiện theo nấc / cảnh báo → đánh dấu đã làm
  if (doneLevelId) {
    const levelId = doneLevelId;
    await db
      .update(planLevels)
      .set({ status: "done", filledPrice: trade.price })
      .where(and(eq(planLevels.id, levelId), eq(planLevels.positionId, positionId)));
    await db
      .update(alerts)
      .set({ status: "done" })
      .where(and(eq(alerts.levelId, levelId), eq(alerts.status, "new")));
  }
  if (alertId) {
    await db.update(alerts).set({ status: "done" }).where(eq(alerts.id, alertId));
  }

  const after = computeHolding([...txs, { id: Number.MAX_SAFE_INTEGER, side, ...trade }]);
  const updates: Partial<typeof positions.$inferInsert> = {};
  if (after.quantity === 0) updates.status = "closed";
  else if (position.status === "closed") updates.status = "open";
  if (side === "buy" && !position.lastPrice) updates.lastPrice = trade.price;
  if (Object.keys(updates).length) {
    await db.update(positions).set(updates).where(eq(positions.id, positionId));
  }

  refreshAll();
  // Bán hết = đóng mã: rời danh mục đang nắm giữ, quay về trang tổng quan
  if (after.quantity === 0) redirect(`/?closed=${encodeURIComponent(position.symbol)}`);
  const verb = side === "buy" ? "mua" : "bán";
  return { ok: `Đã ghi lệnh ${verb}. Giá vốn mới: ${formatPrice(after.avgCost)}.` + planNote };
}

export async function deleteTransaction(transactionId: number) {
  await requireAuth();
  const db = await getDb();
  const [tx] = await db.delete(transactions).where(eq(transactions.id, transactionId)).returning();
  // Lệnh đã thực hiện một nấc: xóa lệnh thì nấc đó về lại trạng thái chờ
  if (tx?.levelId) {
    await db
      .update(planLevels)
      .set({ status: "pending", filledPrice: null, notifiedAt: null })
      .where(and(eq(planLevels.id, tx.levelId), eq(planLevels.status, "done")));
  }
  refreshAll();
}

// ---------- Nấc & cảnh báo ----------

/**
 * Bỏ qua một nấc: lưu giá kế hoạch hiện tại của nấc làm giá mốc, để các nấc sau vẫn tính tiếp từ giá này
 * (không bị kéo về đúng giá của nấc vừa bỏ qua rồi nhắc lại ngay).
 */
async function skipLevel(levelId: number) {
  const db = await getDb();
  const anchor = await getLevelPlanPrice(levelId);
  await db.update(planLevels).set({ status: "skipped", filledPrice: anchor }).where(eq(planLevels.id, levelId));
}

export async function setLevelStatus(levelId: number, status: "pending" | "done" | "skipped") {
  await requireAuth();
  const db = await getDb();
  if (status === "skipped") {
    await skipLevel(levelId);
  } else {
    await db
      .update(planLevels)
      .set({ status, ...(status === "pending" && { notifiedAt: null, filledPrice: null }) })
      .where(eq(planLevels.id, levelId));
  }
  if (status !== "pending") {
    await db
      .update(alerts)
      .set({ status })
      .where(and(eq(alerts.levelId, levelId), eq(alerts.status, "new")));
  }
  refreshAll();
}

/** Xử lý cảnh báo đang chờ. Đã xử lý (đã làm / bỏ qua) thì không hoàn tác. */
export async function setAlertStatus(alertId: number, status: "done" | "skipped") {
  await requireAuth();
  const db = await getDb();
  const [alert] = await db
    .update(alerts)
    .set({ status })
    .where(and(eq(alerts.id, alertId), eq(alerts.status, "new")))
    .returning();
  if (alert?.levelId) {
    if (status === "skipped") await skipLevel(alert.levelId);
    else await db.update(planLevels).set({ status }).where(eq(planLevels.id, alert.levelId));
  }
  refreshAll();
}

export async function markAllAlertsSeen() {
  await requireAuth();
  const db = await getDb();
  // Theo thứ tự nấc trong chuỗi, để mỗi nấc lấy đúng giá mốc sau khi nấc trước đã bỏ qua
  const open = await db
    .select({ alert: alerts, sortOrder: planLevels.sortOrder })
    .from(alerts)
    .leftJoin(planLevels, eq(alerts.levelId, planLevels.id))
    .where(eq(alerts.status, "new"))
    .orderBy(planLevels.sortOrder, planLevels.id);
  for (const { alert: a } of open) {
    await db.update(alerts).set({ status: "skipped" }).where(eq(alerts.id, a.id));
    if (a.levelId) await skipLevel(a.levelId);
  }
  refreshAll();
}

// ---------- Giá ----------

export async function refreshPrices(): Promise<ActionState> {
  await requireAuth();
  const s = await runPriceCheck();
  refreshAll();
  if (s.checked === 0) return { ok: "Chưa có mã nào đang nắm giữ." };
  if (s.updated.length === 0) {
    return { error: `Không lấy được giá. ${s.errors.join("; ")}`.trim() };
  }
  const parts = [`Đã cập nhật giá ${s.updated.length}/${s.checked} mã.`];
  if (s.missing.length) parts.push(`Không có giá: ${s.missing.join(", ")}.`);
  parts.push(s.alerts.length ? `${s.alerts.length} cảnh báo mới.` : "Chưa có nấc nào được chạm.");
  if (s.telegram === "failed") parts.push("Gửi Telegram thất bại.");
  return { ok: parts.join(" ") };
}

export async function setManualPrice(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireAuth();
  const positionId = parseIntInput(formData.get("positionId"));
  const price = parseIntInput(formData.get("price"));
  if (!positionId) return { error: "Thiếu mã vị thế." };
  if (!price) return { error: "Nhập giá theo đồng, VD 23.250." };
  const db = await getDb();
  const [position] = await db.select({ exchange: positions.exchange }).from(positions).where(eq(positions.id, positionId));
  if (!position) return { error: "Không tìm thấy vị thế." };
  const error = priceError(position.exchange, price);
  if (error) return { error };
  const res = await applyManualPrice(positionId, price);
  refreshAll();
  return {
    ok: res.alerts.length
      ? `Đã cập nhật giá. ${res.alerts.length} cảnh báo mới.`
      : "Đã cập nhật giá. Chưa chạm nấc nào.",
  };
}

export async function lookupSymbolAction(symbol: string) {
  await requireAuth();
  if (!/^[A-Za-z0-9]{3,10}$/.test(symbol)) return null;
  return lookupSymbol(symbol);
}

/** Lưu % phí mua/bán của công ty chứng khoán (nhập theo %, VD 0,15) */
export async function saveFeeSettings(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireAuth();
  const buy = parseDecimalInput(formData.get("buyFee"));
  const sell = parseDecimalInput(formData.get("sellFee"));
  const error = feePctError(buy) ?? feePctError(sell);
  if (error) return { error };
  await saveFeeRates(buy! / 100, sell! / 100);
  refreshAll();
  return { ok: "Đã lưu phí. Các lệnh mới và số liệu dự tính dùng tỷ lệ này; lệnh cũ giữ nguyên phí đã ghi." };
}

export async function sendTestTelegram(): Promise<ActionState> {
  await requireAuth();
  const res = await sendTelegram("✅ DCA Mate: kết nối Telegram thành công.");
  return res.ok ? { ok: "Đã gửi tin nhắn thử. Kiểm tra Telegram nhé." } : { error: res.error };
}
