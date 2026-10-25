import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, openGraph, siteUrl } from "@/lib/site";
import "./globals.css";

// IBM Plex Sans: phông cho sản phẩm tài chính, có đủ dấu tiếng Việt
const appFont = IBM_Plex_Sans({
  variable: "--font-app",
  subsets: ["vietnamese", "latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: { default: SITE_TITLE, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: ["DCA", "trung bình giá", "chốt lời", "cổ phiếu", "chứng khoán Việt Nam", "giá vốn", "nhắc giá Telegram"],
  appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: "default" },
  // Giá, khối lượng là dãy số dài: không để Safari iOS tự biến thành số điện thoại
  formatDetection: { telephone: false, email: false, address: false },
  openGraph: openGraph("/"),
  twitter: { card: "summary_large_image", title: SITE_TITLE, description: SITE_DESCRIPTION },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1116" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className={`${appFont.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
