import { describe, expect, it } from "vitest";
import { dcaLevelErrors, priceError, tpLevelErrors, tradeErrors } from "./validate";

describe("kiểm tra giá", () => {
  it("đúng bước giá theo sàn", () => {
    expect(priceError("HOSE", 21_000)).toBeNull();
    expect(priceError("HOSE", 21_030)).toContain("bước 50đ");
    expect(priceError("HOSE", 9_990)).toBeNull();
    expect(priceError("HNX", 12_350)).toContain("bước 100đ");
  });

  it("giới hạn trên dưới", () => {
    expect(priceError("HOSE", 25)).toContain("tối thiểu");
    expect(priceError("HOSE", 6_000_000)).toContain("tối đa");
    expect(priceError("HOSE", null)).toBeNull();
  });
});

describe("kiểm tra lệnh", () => {
  const base = { exchange: "HOSE" as const, price: 21_000, quantity: 1_000, fee: 31_500, tax: 0 };

  it("lệnh hợp lệ không có lỗi", () => {
    expect(tradeErrors({ ...base, side: "buy" })).toEqual({});
  });

  it("bán quá số đang giữ", () => {
    const e = tradeErrors({ ...base, side: "sell", quantity: 5_000, holdingQty: 3_723 });
    expect(e.quantity).toContain("3.723");
  });

  it("phí, thuế vượt 1% giá trị lệnh hoặc âm", () => {
    expect(tradeErrors({ ...base, side: "buy", fee: 300_000 }).fee).toContain("tối đa 1%");
    expect(tradeErrors({ ...base, side: "sell", tax: -1, holdingQty: 1_000 }).tax).toContain("âm");
  });

  it("khối lượng phải lớn hơn 0", () => {
    expect(tradeErrors({ ...base, side: "buy", quantity: 0 }).quantity).toBeDefined();
  });
});

describe("kiểm tra nấc", () => {
  it("nấc DCA", () => {
    expect(dcaLevelErrors(10, 1_000)).toEqual({});
    expect(dcaLevelErrors(150, 1_000).pct).toBeDefined();
    expect(dcaLevelErrors(10, 1_050).amount).toContain("bội số của 100");
  });

  it("nấc chốt lời", () => {
    expect(tpLevelErrors(10, 30)).toEqual({});
    expect(tpLevelErrors(10, 120).amount).toContain("100%");
    expect(tpLevelErrors(0, 30).pct).toBeDefined();
  });
});
