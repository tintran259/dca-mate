import { ImageResponse } from "next/og";
import { SITE_NAME } from "@/lib/site";

// Ảnh xem trước khi gửi link (Zalo, Telegram, Facebook...)
export const alt = "DCA Mate: kế hoạch DCA và nhắc chốt lời cổ phiếu";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "#f5f6f8",
          color: "#14171c",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <Logo size={96} />
          <div style={{ fontSize: 56 }}>{SITE_NAME}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 60, lineHeight: 1.2, letterSpacing: -1 }}>
            Lập kế hoạch lúc tỉnh táo, làm đúng kế hoạch khi thị trường biến động.
          </div>
          <div style={{ fontSize: 32, color: "#646c78" }}>
            Giá vốn tự tính · DCA và chốt lời theo nấc · Nhắc qua Telegram
          </div>
        </div>
      </div>
    ),
    size,
  );
}

function Logo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64">
      <rect width="64" height="64" rx="14" fill="#2453d6" />
      <path d="M12 22l12 12 8-8 20 20M40 46h12V34" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
