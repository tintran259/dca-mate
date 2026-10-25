import Link from "next/link";
import { Suspense } from "react";
import { FeeRatesProvider } from "@/components/fee-rates";
import { ArrowLeftIcon } from "@/components/icons";
import { NewPositionForm } from "@/components/new-position-form";
import { PageHeader, Skeleton } from "@/components/ui";
import { getFeeRates } from "@/lib/fees";

export const metadata = { title: "Thêm mã" };

export default function NewPositionPage() {
  return (
    <>
      <PageHeader
        back={
          <Link href="/" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
            <ArrowLeftIcon size={16} /> Tổng quan
          </Link>
        }
        title="Thêm mã mới"
        subtitle="Ghi lệnh mua đầu tiên và đặt kế hoạch cho mã này"
      />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <FormWithFees />
      </Suspense>
    </>
  );
}

/** Đọc tỷ lệ phí trong Cài đặt để form tự điền phí mua đúng */
async function FormWithFees() {
  return (
    <FeeRatesProvider rates={await getFeeRates()}>
      <NewPositionForm />
    </FeeRatesProvider>
  );
}
