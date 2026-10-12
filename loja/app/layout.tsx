import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PILI — Loja",
  description: "Gestão da loja de conveniência (estoque, produtos, entradas)",
};

/* Sem next/font: o computador da loja pode ligar sem internet, e fonte do
 * Google precisaria baixar. O CSS cai nas fontes do próprio sistema. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
