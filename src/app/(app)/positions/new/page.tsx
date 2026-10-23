import Link from "next/link";
import { ArrowLeftIcon } from "@/components/icons";
import { NewPositionForm } from "@/components/new-position-form";
import { PageHeader } from "@/components/ui";

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
      <NewPositionForm />
    </>
  );
}
