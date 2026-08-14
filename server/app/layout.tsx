import type { Metadata } from "next";
import { Sora, Public_Sans } from "next/font/google";
import "./globals.css";

const sora = Sora({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-display" });
const publicSans = Public_Sans({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "PILI LAVE",
  description: "Servidor e painel do PILI LAVE",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={`${sora.variable} ${publicSans.variable}`}>{children}</body>
    </html>
  );
}
