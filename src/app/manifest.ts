import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DCA Mate",
    short_name: "DCA Mate",
    description: "Kế hoạch DCA và nhắc chốt lời cổ phiếu",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f6f8",
    theme_color: "#2453d6",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
