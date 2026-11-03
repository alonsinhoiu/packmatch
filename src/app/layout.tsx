import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PackMatch · Conciliación pre-despacho",
  description:
    "Conciliación asimétrica entre Commercial Invoice y Packing List con trazabilidad de origen (INV-L* / PL-R*), separación entre extracción y cálculo determinista, y recálculo instantáneo en 0 ms.",
  icons: {
    icon: "/brand/packmatch-icon.svg",
    shortcut: "/brand/packmatch-icon.svg",
    apple: "/brand/icon-180.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
