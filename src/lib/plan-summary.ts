// Lãi dự kiến nếu các nấc chốt lời còn chờ khớp đúng kế hoạch, tính trên số cổ và giá vốn hiện tại.

type TpLevel = {
  kind: "dca" | "tp";
  status: "pending" | "notified" | "done" | "skipped";
  trigger: number | null;
  distancePct: number | null;
  sellQuantity: number | null;
  tpRemaining: number | null;
  tpProfit: number | null;
};

export type TpPlanSummary = {
  /** Có ít nhất 1 nấc chốt lời còn chờ (và còn cổ để bán) */
  hasPlan: boolean;
  /** Số nấc chốt lời còn chờ */
  steps: number;
  /** Tổng lời của các nấc còn chờ, đã trừ phí và thuế bán */
  plannedProfit: number;
  /** % so với vốn đang rót */
  plannedPct: number | null;
  /** Tổng số cổ bán theo kế hoạch */
  sellQuantity: number;
  /** Số cổ còn giữ sau nấc chốt lời cuối (0 = kế hoạch bán hết) */
  remainingAfter: number;
  /** Nấc chốt lời còn chờ gần nhất theo thứ tự chuỗi */
  next: { trigger: number; distancePct: number | null } | null;
};

export function tpPlanSummary(holding: { quantity: number; totalCost: number }, levels: TpLevel[]): TpPlanSummary {
  // Theo thứ tự chuỗi; nấc bán 0 cổ (đã bán hết ở nấc trước) không tính
  const active = levels.filter(
    (l) => l.kind === "tp" && (l.status === "pending" || l.status === "notified") && (l.sellQuantity ?? 0) > 0,
  );
  const plannedProfit = active.reduce((s, l) => s + (l.tpProfit ?? 0), 0);
  const sellQuantity = active.reduce((s, l) => s + (l.sellQuantity ?? 0), 0);
  const last = active.at(-1);
  const first = active[0];
  return {
    hasPlan: active.length > 0 && holding.quantity > 0,
    steps: active.length,
    plannedProfit,
    plannedPct: holding.totalCost ? (plannedProfit / holding.totalCost) * 100 : null,
    sellQuantity,
    remainingAfter: last ? (last.tpRemaining ?? holding.quantity - sellQuantity) : holding.quantity,
    next: first?.trigger ? { trigger: first.trigger, distancePct: first.distancePct } : null,
  };
}
