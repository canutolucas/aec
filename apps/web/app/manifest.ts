import type { MetadataRoute } from "next";

/**
 * Web App Manifest — o que o Android le para o "Adicionar a tela inicial".
 * O iOS ignora isto (usa apple-icon.tsx em vez disso); os dois formam a
 * cobertura completa de tela inicial nas duas plataformas.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "aec — Controle Bancario",
    short_name: "aec",
    description: "Conciliacao bancaria e controle financeiro para assessoria contabil",
    start_url: "/",
    display: "standalone",
    background_color: "#f1f0ec",
    theme_color: "#01416d",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
