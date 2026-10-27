import { describe, expect, it } from "vitest";
import type { PriceEvent } from "./calc";
import { buildTelegramAlert, type AlertItem } from "./telegram-message";

const dca = (symbol: string, positionId: number, levelNo = 1): AlertItem => ({
  symbol,
  positionId,
  price: 18_900,
  event: {
    kind: "dca",
    levelId: 10 + levelNo,
    message: "",
    info: {
      kind: "dca",
      levelNo,
      pct: -10,
      quantity: 1_000,
      amount: 18_900_000,
      avgBefore: 21_031.5,
      avgAfter: 19_980,
      vsFirstPct: -10,
      overCapital: false,
    },
  },
});

const tp = (symbol: string, positionId: number, profit = 2_000_000): AlertItem => ({
  symbol,
  positionId,
  price: 23_150,
  event: {
    kind: "tp",
    levelId: 20,
    message: "",
    info: { kind: "tp", levelNo: 1, pct: 10, quantity: 300, remaining: 700, profit, avgCost: 21_031.5, vsAvgPct: 10.1 },
  },
});

const WEB = new URL("https://dca-mate.vercel.app");

describe("tin Telegram: DCA và chốt lời tách khối", () => {
  it("khối DCA đứng trước khối chốt lời, có tiêu đề và động từ riêng", () => {
    const { text } = buildTelegramAlert([tp("FPT", 2), dca("HPG", 1)], WEB);
    const iDca = text.indexOf("🔴 <b>MUA THÊM (DCA)</b> · 1 nấc");
    const iTp = text.indexOf("🟢 <b>CHỐT LỜI (BÁN)</b> · 1 nấc");
    expect(iDca).toBeGreaterThanOrEqual(0);
    expect(iTp).toBeGreaterThan(iDca);
    expect(text).toContain("👉 <b>MUA 1.000 cp</b>");
    expect(text).toContain("👉 <b>BÁN 300 cp</b>, còn lại 700 cp");
    expect(text).toContain("Lãi ước tính: <b>+2,0 tr</b>");
  });

  it("chỉ có DCA thì không có khối chốt lời", () => {
    const { text } = buildTelegramAlert([dca("HPG", 1), dca("HPG", 1, 2)], WEB);
    expect(text).toContain("MUA THÊM (DCA)</b> · 2 nấc");
    expect(text).not.toContain("CHỐT LỜI");
  });

  it("lỗ ở nấc chốt lời ghi rõ chữ Lỗ và dấu trừ", () => {
    expect(buildTelegramAlert([tp("FPT", 2, -150_000)], WEB).text).toContain("Lỗ ước tính: <b>−150.000đ</b>");
  });

  it("địa chỉ https: mỗi mã một nút (không trùng), 2 nút một hàng, cuối là xem tất cả", () => {
    const { buttons, text } = buildTelegramAlert([dca("HPG", 1), dca("HPG", 1, 2), tp("FPT", 2), tp("VNM", 3)], WEB);
    expect(buttons).toEqual([
      [
        { text: "Mở HPG", url: "https://dca-mate.vercel.app/positions/1" },
        { text: "Mở FPT", url: "https://dca-mate.vercel.app/positions/2" },
      ],
      [{ text: "Mở VNM", url: "https://dca-mate.vercel.app/positions/3" }],
      [{ text: "Xem tất cả cảnh báo", url: "https://dca-mate.vercel.app/alerts" }],
    ]);
    expect(text).not.toContain("🔗");
  });

  it("localhost: không dùng nút, link ghi trong tin", () => {
    const { buttons, text } = buildTelegramAlert([dca("HPG", 1)], new URL("http://localhost:3000"));
    expect(buttons).toEqual([]);
    expect(text).toContain("🔗 http://localhost:3000/positions/1");
    expect(text).toContain("Xem tất cả cảnh báo: http://localhost:3000/alerts");
  });

  it("thoát ký tự HTML trong nội dung", () => {
    const other: AlertItem = {
      symbol: "A&B",
      positionId: 9,
      price: 10_000,
      event: { kind: "stop", levelId: null, message: "giá <10k" } satisfies PriceEvent,
    };
    const { text } = buildTelegramAlert([other], WEB);
    expect(text).toContain("<b>A&amp;B</b> giá &lt;10k");
  });
});
