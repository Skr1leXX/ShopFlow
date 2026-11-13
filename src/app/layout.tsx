import type { Metadata } from "next";
import { Inter, Cormorant_Garamond } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin", "cyrillic"] });
const display = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin", "cyrillic"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: { default: "ShopFlow — одежда и аксессуары", template: "%s · ShopFlow" },
  description: "Интернет-магазин одежды и аксессуаров ShopFlow.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${inter.variable} ${display.variable}`}>
      <body className="min-h-screen flex flex-col">{children}</body>
    </html>
  );
}
