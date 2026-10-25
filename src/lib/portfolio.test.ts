import { describe, expect, it } from "vitest";
import type { TxInput } from "./calc";
import { buildIntraday, buildPortfolioHistory, buildPriceHistory, periodStart } from "./portfolio";

const tx = (id: number, side: "buy" | "sell", tradeDate: string, price: number, quantity: number, fee = 0): TxInput => ({
  id,
  side,
  tradeDate,
  price,
  quantity,
  fee,
  tax: 0,
});

describe("lịch sử giá trị danh mục", () => {
  const ctg = { symbol: "CTG", lastPrice: 30_950, txs: [tx(1, "buy", "2026-10-20", 34_000, 100, 5_100)] };
  const closes = new Map([
    [
      "CTG",
      [
        { date: "2026-10-16", close: 35_000 },
        { date: "2026-10-20", close: 33_000 },
        { date: "2026-10-21", close: 32_000 },
        { date: "2026-10-23", close: 31_000 },
      ],
    ],
  ]);

  it("bắt đầu từ ngày mua đầu tiên, mỗi ngày có giá đóng cửa là một điểm, điểm cuối là hôm nay", () => {
    const pts = buildPortfolioHistory([ctg], closes, "2026-10-25");
    expect(pts.map((p) => p.date)).toEqual(["2026-10-20", "2026-10-21", "2026-10-23", "2026-10-25"]);
  });

  it("giá trị = số cổ đang giữ × giá đóng cửa; vốn gồm phí mua", () => {
    const [first, second] = buildPortfolioHistory([ctg], closes, "2026-10-25");
    expect(first.value).toBe(3_300_000);
    expect(second.value).toBe(3_200_000);
    expect(first.capital).toBe(3_405_100);
    expect(first.bySymbol).toEqual({ CTG: 3_300_000 });
  });

  it("điểm hôm nay dùng giá hiện tại để khớp với số liệu tổng quan", () => {
    const last = buildPortfolioHistory([ctg], closes, "2026-10-25").at(-1)!;
    expect(last.value).toBe(3_095_000);
  });

  it("không có giá đóng cửa thì dùng giá khớp của lệnh gần nhất", () => {
    const pos = { symbol: "FPT", lastPrice: null, txs: [tx(1, "buy", "2026-10-01", 100_000, 100), tx(2, "buy", "2026-10-10", 90_000, 100)] };
    const pts = buildPortfolioHistory([pos], new Map(), "2026-10-25");
    expect(pts.map((p) => [p.date, p.value])).toEqual([
      ["2026-10-01", 10_000_000],
      ["2026-10-10", 18_000_000],
      ["2026-10-25", 18_000_000],
    ]);
  });

  it("bán bớt thì giá trị và vốn giảm theo; bán hết thì mã rời khỏi biểu đồ", () => {
    const pos = {
      symbol: "HPG",
      lastPrice: 25_000,
      txs: [tx(1, "buy", "2026-10-01", 20_000, 1_000), tx(2, "sell", "2026-10-05", 22_000, 400), tx(3, "sell", "2026-10-08", 23_000, 600)],
    };
    const pts = buildPortfolioHistory([pos], new Map(), "2026-10-25");
    expect(pts.find((p) => p.date === "2026-10-05")).toMatchObject({ value: 13_200_000, capital: 12_000_000 });
    expect(pts.find((p) => p.date === "2026-10-08")).toMatchObject({ value: 0, capital: 0, bySymbol: {} });
  });

  it("cộng nhiều mã; cùng mã mở lại sau khi đóng thì gộp chung một dòng", () => {
    const fpt = { symbol: "FPT", lastPrice: 100_000, txs: [tx(1, "buy", "2026-10-21", 100_000, 100)] };
    const pts = buildPortfolioHistory([ctg, fpt], closes, "2026-10-25");
    expect(pts.at(-1)).toMatchObject({ value: 3_095_000 + 10_000_000, bySymbol: { CTG: 3_095_000, FPT: 10_000_000 } });
    expect(pts[0].bySymbol).toEqual({ CTG: 3_300_000 });
  });

  it("chưa có lệnh nào thì không có điểm", () => {
    expect(buildPortfolioHistory([], new Map(), "2026-10-25")).toEqual([]);
  });
});

describe("lịch sử giá các mã đang giữ", () => {
  const closes = new Map([
    ["CTG", [{ date: "2026-10-22", close: 32_000 }, { date: "2026-10-23", close: 31_000 }]],
    ["FPT", [{ date: "2026-10-23", close: 99_000 }]],
  ]);

  it("gộp theo ngày, không phụ thuộc ngày mua; điểm hôm nay dùng giá hiện tại", () => {
    const pts = buildPriceHistory(
      [
        { symbol: "CTG", lastPrice: 30_950 },
        { symbol: "FPT", lastPrice: null },
      ],
      closes,
      "2026-10-25",
    );
    expect(pts).toEqual([
      { date: "2026-10-22", closes: { CTG: 32_000 } },
      { date: "2026-10-23", closes: { CTG: 31_000, FPT: 99_000 } },
      { date: "2026-10-25", closes: { CTG: 30_950 } },
    ]);
  });

  it("không có lịch sử giá thì chỉ còn điểm hôm nay", () => {
    expect(buildPriceHistory([{ symbol: "CTG", lastPrice: 30_950 }], new Map(), "2026-10-25")).toEqual([
      { date: "2026-10-25", closes: { CTG: 30_950 } },
    ]);
  });
});

describe("mốc bắt đầu của khung thời gian (tròn theo lịch)", () => {
  // 25/10/2026 là Chủ nhật
  it.each([
    ["1w", "2026-10-19"],
    ["1m", "2026-10-01"],
    ["3m", "2026-08-01"],
    ["6m", "2026-05-01"],
    ["1y", "2025-11-01"],
  ] as const)("%s → từ %s", (period, start) => {
    expect(periodStart(period, "2026-10-25")).toBe(start);
  });

  it("1W vào thứ Hai thì bắt đầu ngay hôm đó", () => {
    expect(periodStart("1w", "2026-10-26")).toBe("2026-10-26");
  });

  it("lùi qua năm trước: tháng 2 chọn 3M thì từ 1/12 năm trước", () => {
    expect(periodStart("3m", "2026-02-10")).toBe("2025-12-01");
  });
});

describe("giá trong phiên", () => {
  it("chỉ lấy phiên gần nhất; mã chưa khớp ở một mốc giờ thì giữ giá mốc trước", () => {
    const candles = new Map([
      [
        "CTG",
        [
          { date: "2026-10-22", time: "14:45", close: 30_500 },
          { date: "2026-10-23", time: "09:15", close: 30_600 },
          { date: "2026-10-23", time: "09:20", close: 30_700 },
        ],
      ],
      ["FPT", [{ date: "2026-10-23", time: "09:20", close: 99_000 }]],
    ]);
    expect(buildIntraday(candles)).toEqual({
      date: "2026-10-23",
      points: [
        { time: "09:15", closes: { CTG: 30_600 } },
        { time: "09:20", closes: { CTG: 30_700, FPT: 99_000 } },
      ],
    });
  });

  it("không có nến thì không có điểm", () => {
    expect(buildIntraday(new Map())).toEqual({ date: null, points: [] });
  });
});
