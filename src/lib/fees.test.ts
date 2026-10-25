import { describe, expect, it } from "vitest";
import { breakEvenPrice, computeHolding, unrealizedPnl, type TxInput } from "./calc";
import {
  DEFAULT_FEES,
  SELL_TAX_RATE,
  buyFee,
  feePctError,
  formatRate,
  isTradingHours,
  netSellRate,
  sellFee,
  sellTax,
  type FeeRates,
} from "./market";

const FEES: FeeRates = { buy: 0.0015, sell: 0.0015, tax: 0.001 };

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
  it("mặc định khi chưa lưu trong Cài đặt: phí mua, phí bán 0,15%; thuế bán 0,1%", () => {
    expect(DEFAULT_FEES).toEqual({ buy: 0.0015, sell: 0.0015, tax: 0.001 });
    expect(SELL_TAX_RATE).toBe(0.001);
  });

  it("đổi tỷ lệ phí thì phí tự tính, giá hòa vốn đổi theo", () => {
    const vps: FeeRates = { buy: 0.001, sell: 0.002, tax: 0.001 };
    expect(buyFee(21_000, 1_000, vps)).toBe(21_000);
    expect(sellFee(21_000, 1_000, vps)).toBe(42_000);
    expect(netSellRate(vps)).toBeCloseTo(0.997);
    expect(breakEvenPrice(30_000, vps)).toBeCloseTo(30_000 / 0.997);
  });

  it("hiển thị tỷ lệ dạng phần trăm kiểu Việt Nam", () => {
    expect(formatRate(0.0015)).toBe("0,15%");
    expect(formatRate(0.001)).toBe("0,1%");
    expect(formatRate(0.00125)).toBe("0,125%");
  });

  it("kiểm tra % phí nhập trong Cài đặt (đơn vị %)", () => {
    expect(feePctError(0.15)).toBeNull();
    expect(feePctError(0)).toBeNull();
    expect(feePctError(null)).toMatch(/Nhập % phí/);
    expect(feePctError(-0.1)).toMatch(/không được âm/);
    // Gõ nhầm 15 (tưởng là phần nghìn) hay 1,5 đều bị chặn
    expect(feePctError(1.5)).toMatch(/dưới 1%/);
    expect(feePctError(15)).toMatch(/dưới 1%/);
  });

  it("tự tính phí, thuế theo giá trị lệnh", () => {
    expect(buyFee(21_000, 1_000, FEES)).toBe(31_500);
    expect(sellFee(31_000, 100, FEES)).toBe(4_650);
    expect(sellTax(31_000, 100, FEES)).toBe(3_100);
  });

  it("làm tròn tới đồng", () => {
    // 21.050 × 100 × 0,15% = 3.157,5
    expect(buyFee(21_050, 100, FEES)).toBe(3_158);
    expect(sellTax(21_050, 100, FEES)).toBe(2_105);
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
    const pnl = unrealizedPnl(holding, 30_950, FEES);
    expect(pnl).toBeCloseTo(-317_837.5);
    expect((pnl / holding.totalCost) * 100).toBeCloseTo(-9.33, 2);
  });

  it("giá hòa vốn bù đủ phí bán và thuế", () => {
    const be = breakEvenPrice(holding.avgCost, FEES);
    expect(be).toBeCloseTo(34_136.34, 2);
    expect(unrealizedPnl(holding, be, FEES)).toBeCloseTo(0);
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
