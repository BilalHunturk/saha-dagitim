import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Saha Dağıtım",
    short_name: "Saha",
    description: "Saha ekibi bölge dağıtımı",
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "tr",
    theme_color: "#0f172a",
    background_color: "#0f172a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
