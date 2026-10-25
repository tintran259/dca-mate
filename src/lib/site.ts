// Thông tin chung cho SEO: tên, mô tả, URL gốc (dùng cho link tuyệt đối trong Open Graph, sitemap).

export const SITE_NAME = "DCA Mate";
export const SITE_TITLE = "DCA Mate: kế hoạch DCA và nhắc chốt lời cổ phiếu";
export const SITE_DESCRIPTION =
  "Ghi lệnh mua bán, tự tính giá vốn, lập kế hoạch DCA và chốt lời theo từng nấc cho cổ phiếu Việt Nam. Nhắc qua Telegram khi giá chạm nấc.";

/** APP_URL nếu có, không thì domain production Vercel tự cấp, cuối cùng là localhost */
export function siteUrl(): URL {
  if (process.env.APP_URL) return new URL(process.env.APP_URL);
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return new URL(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
  return new URL(`http://localhost:${process.env.PORT ?? 3000}`);
}

/** Open Graph dùng chung. Next không gộp sâu openGraph giữa layout và trang, nên trang con dùng lại hàm này */
export function openGraph(url: string) {
  return {
    type: "website" as const,
    locale: "vi_VN",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url,
  };
}
