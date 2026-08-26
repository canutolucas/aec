import "./globals.css";

import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";

import { Providers } from "./providers";

const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Controle Bancario",
  description: "Controle de entradas e saidas bancarias para assessoria contabil",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${archivo.variable} ${ibmPlexMono.variable}`}>
      <body className="bg-background text-foreground min-h-screen font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
