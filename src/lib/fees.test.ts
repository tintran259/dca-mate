import { describe, expect, it } from "vitest";
import { breakEvenPrice, computeHolding, unrealizedPnl, type TxInput } from "./calc";
import { BUY_FEE_RATE, SELL_FEE_RATE, SELL_TAX_RATE, buyFee, isTradingHours, sellFee, sellTax } from "./market";

const tx = (id: number, side: "buy" | "sell", price: number, quantity: number, fee: number, tax = 0): TxInput => ({
  id,
  side,
  tradeDate: `2026-01-0${id}`,
  price,
  quantity,
  fee,
  tax,
});

describe("phí và thuế mặc định", () => {
  it("phí mua, phí bán 0,15%; thuế bán 0,1%", () => {
    expect(BUY_FEE_RATE).toBe(0.0015);
    expect(SELL_FEE_RATE).toBe(0.0015);
    expect(SELL_TAX_RATE).toBe(0.001);
  });

  it("tự tính phí, thuế theo giá trị lệnh", () => {
    expect(buyFee(21_000, 1_000)).toBe(31_500);
    expect(sellFee(31_000, 100)).toBe(4_650);
    expect(sellTax(31_000, 100)).toBe(3_100);
  });

  it("làm tròn tới đồng", () => {
    // 21.050 × 100 × 0,15% = 3.157,5
    expect(buyFee(21_050, 100)).toBe(3_158);
    expect(sellTax(21_050, 100)).toBe(2_105);
  });
});

describe("phí trong giá vốn và lãi/lỗ", () => {
  // Ví dụ thực tế: mua CTG 34.000 × 100, giá thị trường 30.950
  const holding = computeHolding([tx(1, "buy", 34_000, 100, 5_100)]);

  it("giá vốn TB gồm phí mua", () => {
    expect(holding.totalCost).toBe(3_405_100);
    expect(holding.avgCost).toBe(34_051);
  });

  it("lãi/lỗ tạm tính trừ phí và thuế bán: 30.950 so với 34.000 là lỗ khoảng 9,3%", () => {
    const pnl = unrealizedPnl(holding, 30_950);
    expect(pnl).toBeCloseTo(-317_837.5);
    expect((pnl / holding.totalCost) * 100).toBeCloseTo(-9.33, 2);
  });

  it("giá hòa vốn bù đủ phí bán và thuế", () => {
    const be = breakEvenPrice(holding.avgCost);
    expect(be).toBeCloseTo(34_136.34, 2);
    expect(unrealizedPnl(holding, be)).toBeCloseTo(0);
  });

  it("lãi đã chốt trừ phí, thuế của lệnh bán và phí mua đã vào giá vốn", () => {
    const h = computeHolding([tx(1, "buy", 34_000, 100, 5_100), tx(2, "sell", 36_000, 100, 5_400, 3_600)]);
    expect(h.realizedPnl).toBe(185_900);
    expect(h.quantity).toBe(0);
  });

  it("dùng phí đã ghi trong lệnh, không tính lại theo tỷ lệ", () => {
    const h = computeHolding([tx(1, "buy", 34_000, 100, 0)]);
    expect(h.avgCost).toBe(34_000);
  });
});

describe("giờ trong phiên (giờ Việt Nam = UTC+7)", () => {
  // 26/10/2026 là thứ Hai
  const vn = (date: string, time: string) => new Date(`${date}T${time}:00+07:00`);

  it.each([
    ["08:59", false],
    ["09:00", true],
    ["10:15", true],
    ["11:30", true],
    ["11:31", false],
    ["12:00", false],
    ["12:59", false],
    ["13:00", true],
    ["14:45", true],
    ["15:00", true],
    ["15:01", false],
    ["20:00", false],
  ])("thứ Hai %s → %s", (time, expected) => {
    expect(isTradingHours(vn("2026-10-26", time))).toBe(expected);
  });

  it("thứ Sáu trong phiên, thứ Bảy và Chủ nhật thì không", () => {
    expect(isTradingHours(vn("2026-10-30", "14:00"))).toBe(true);
    expect(isTradingHours(vn("2026-10-24", "10:00"))).toBe(false);
    expect(isTradingHours(vn("2026-10-25", "10:00"))).toBe(false);
  });

  it("không phụ thuộc múi giờ của máy: 02:00 UTC là 9:00 sáng ở Việt Nam", () => {
    expect(isTradingHours(new Date("2026-10-26T02:00:00Z"))).toBe(true);
    expect(isTradingHours(new Date("2026-10-26T01:59:00Z"))).toBe(false);
  });
});
