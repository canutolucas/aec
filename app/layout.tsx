import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Controle Bancario",
  description: "Controle de entradas e saidas bancarias para assessoria contabil",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
