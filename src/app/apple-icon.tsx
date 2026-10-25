import { ImageResponse } from "next/og";

// iOS không dùng icon SVG cho "Thêm vào màn hình chính": tạo PNG 180×180 từ cùng logo
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#2453d6" }}>
        <svg width="180" height="180" viewBox="0 0 64 64">
          <path d="M12 22l12 12 8-8 20 20M40 46h12V34" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    ),
    size,
  );
}
