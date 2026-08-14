import type { Metadata, Viewport } from "next";
import "./pwa.css";
import { SwRegister } from "./sw-register";

export const metadata: Metadata = {
  title: "PILI LAVE",
  description: "Lavagem sem fila: pague pelo celular e mostre o QR ao lavador.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "PILI LAVE" },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#0B1418",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function PwaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="pw">
      <SwRegister />
      {children}
    </div>
  );
}
