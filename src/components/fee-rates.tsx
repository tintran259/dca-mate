"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { FeeRates } from "@/lib/market";

// Tỷ lệ phí từ Cài đặt, server đọc rồi truyền xuống để form trên trình duyệt tính giống hệt server
const FeeRatesContext = createContext<FeeRates | null>(null);

export function FeeRatesProvider({ rates, children }: { rates: FeeRates; children: ReactNode }) {
  return <FeeRatesContext.Provider value={rates}>{children}</FeeRatesContext.Provider>;
}

export function useFeeRates(): FeeRates {
  const rates = useContext(FeeRatesContext);
  if (!rates) throw new Error("Thiếu FeeRatesProvider: bọc trang bằng <FeeRatesProvider rates={await getFeeRates()}>");
  return rates;
}
