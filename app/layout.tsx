import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { GeistSerifTriangle } from "geist/font/serif/triangle";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-boot";
import { FluidBackground } from "@/components/FluidBackground";
import "./globals.css";

export const metadata: Metadata = {
  title: "Altron",
  description:
    "A private futures desk that trades in the open. Members watch our quant's ES and NQ positions live: entry, size, stop, target and the reasoning behind each one.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0A0B0D" },
    { media: "(prefers-color-scheme: light)", color: "#F6F7F9" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${GeistSans.variable} ${GeistMono.variable} ${GeistSerifTriangle.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <FluidBackground />
        {children}
      </body>
    </html>
  );
}
