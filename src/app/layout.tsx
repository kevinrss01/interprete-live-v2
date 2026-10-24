import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
const sans = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});
export const metadata: Metadata = {
  title: "Interprète",
  description:
    "Traduction vocale en direct, pour deux personnes sur un seul appareil.",
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#fafaf9",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body className={sans.variable}>{children}</body>
    </html>
  );
}
