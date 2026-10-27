import type { PriceEvent } from "./calc";
import { formatMoney, formatPct, formatPrice, formatQty } from "./format";

// Soạn tin Telegram cho các cảnh báo mới: DCA (mua thêm) và chốt lời (bán) tách thành 2 khối rõ ràng,
// mỗi mã có nút mở thẳng trang chi tiết trên web. Hàm thuần, không gửi gì, để test được.

export type AlertItem = {
  symbol: string;
  positionId: number;
  /** Giá lúc chạm nấc */
  price: number;
  event: PriceEvent;
};

export type TelegramButton = { text: string; url: string };

export type TelegramAlert = {
  /** Nội dung định dạng HTML của Telegram (parse_mode HTML) */
  text: string;
  /** Hàng nút bấm dưới tin; rỗng khi địa chỉ web không dùng được cho nút (VD localhost) */
  buttons: TelegramButton[][];
};

const DIVIDER = "━━━━━━━━━━━━━━━";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Telegram chỉ nhận nút có URL https công khai; localhost thì ghi link thành chữ trong tin */
function canUseButtons(base: URL): boolean {
  return base.protocol === "https:" && !["localhost", "127.0.0.1"].includes(base.hostname);
}

function dcaBlock(item: AlertItem, link: string | null): string {
  const { event, price } = item;
  const sym = `<b>${escapeHtml(item.symbol)}</b>`;
  if (event.info?.kind !== "dca") return `📉 ${sym} ${escapeHtml(event.message)}`;
  const i = event.info;
  return [
    `📉 ${sym} · Nấc DCA ${i.levelNo} (${formatPct(i.pct)})`,
    `Giá chạm: <b>${formatPrice(price)}</b> (${formatPct(i.vsFirstPct)} so với giá mua đầu)`,
    `👉 <b>MUA ${formatQty(i.quantity)} cp</b> ≈ ${formatMoney(i.amount)}`,
    `Giá vốn: ${formatPrice(i.avgBefore)} → <b>${formatPrice(i.avgAfter)}</b>`,
    ...(i.overCapital ? ["⚠️ Vượt giới hạn vốn cho mã này"] : []),
    ...(link ? [`🔗 ${link}`] : []),
  ].join("\n");
}

function tpBlock(item: AlertItem, link: string | null): string {
  const { event, price } = item;
  const sym = `<b>${escapeHtml(item.symbol)}</b>`;
  if (event.info?.kind !== "tp") return `📈 ${sym} ${escapeHtml(event.message)}`;
  const i = event.info;
  return [
    `📈 ${sym} · Nấc chốt lời ${i.levelNo} (${formatPct(i.pct)})`,
    `Giá chạm: <b>${formatPrice(price)}</b> (${formatPct(i.vsAvgPct)} so với giá vốn ${formatPrice(i.avgCost)})`,
    `👉 <b>BÁN ${formatQty(i.quantity)} cp</b>, còn lại ${formatQty(i.remaining)} cp`,
    `${i.profit >= 0 ? "Lãi" : "Lỗ"} ước tính: <b>${i.profit >= 0 ? "+" : "−"}${formatMoney(Math.abs(i.profit))}</b>`,
    ...(link ? [`🔗 ${link}`] : []),
  ].join("\n");
}

function section(title: string, blocks: string[]): string {
  return [`${title} · ${blocks.length} nấc`, DIVIDER, blocks.join("\n\n")].join("\n");
}

export function buildTelegramAlert(items: AlertItem[], base: URL): TelegramAlert {
  const buttons = canUseButtons(base);
  const positionUrl = (id: number) => new URL(`/positions/${id}`, base).toString();
  const textLink = (id: number) => (buttons ? null : positionUrl(id));

  const dca = items.filter((x) => x.event.kind === "dca");
  const tp = items.filter((x) => x.event.kind === "tp");
  const other = items.filter((x) => x.event.kind !== "dca" && x.event.kind !== "tp");

  const parts: string[] = [];
  if (dca.length) parts.push(section("🔴 <b>MUA THÊM (DCA)</b>", dca.map((x) => dcaBlock(x, textLink(x.positionId)))));
  if (tp.length) parts.push(section("🟢 <b>CHỐT LỜI (BÁN)</b>", tp.map((x) => tpBlock(x, textLink(x.positionId)))));
  if (other.length) {
    parts.push(
      section(
        "⚠️ <b>CẢNH BÁO KHÁC</b>",
        other.map((x) => `<b>${escapeHtml(x.symbol)}</b> ${escapeHtml(x.event.message)}`),
      ),
    );
  }
  const alertsUrl = new URL("/alerts", base).toString();
  if (!buttons) parts.push(`Xem tất cả cảnh báo: ${alertsUrl}`);

  // Mỗi mã một nút (theo thứ tự xuất hiện, không trùng), 2 nút một hàng, cuối cùng là nút xem tất cả
  const rows: TelegramButton[][] = [];
  if (buttons) {
    const seen = new Map<number, string>();
    for (const x of [...dca, ...tp, ...other]) if (!seen.has(x.positionId)) seen.set(x.positionId, x.symbol);
    const perSymbol = [...seen].map(([id, symbol]) => ({ text: `Mở ${symbol}`, url: positionUrl(id) }));
    for (let i = 0; i < perSymbol.length; i += 2) rows.push(perSymbol.slice(i, i + 2));
    rows.push([{ text: "Xem tất cả cảnh báo", url: alertsUrl }]);
  }

  return { text: parts.join("\n\n"), buttons: rows };
}
