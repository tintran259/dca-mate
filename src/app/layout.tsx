import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

// IBM Plex Sans: phông cho sản phẩm tài chính, có đủ dấu tiếng Việt
const appFont = IBM_Plex_Sans({
  variable: "--font-app",
  subsets: ["vietnamese", "latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: { default: "DCA Mate", template: "%s · DCA Mate" },
  description: "Nhật ký lệnh, kế hoạch DCA và nhắc chốt lời cho nhà đầu tư cổ phiếu.",
  applicationName: "DCA Mate",
  appleWebApp: { capable: true, title: "DCA Mate", statusBarStyle: "default" },
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
