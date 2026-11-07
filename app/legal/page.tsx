import type { Metadata } from "next";
import Link from "next/link";
import { Mark } from "@/components/Mark";

export const metadata: Metadata = {
  title: "Risk disclosure · Altron",
};

export default function LegalPage() {
  return (
    <main style={{ minHeight: "100vh", display: "flex", justifyContent: "center", padding: "96px 24px" }}>
      <div style={{ maxWidth: 640, display: "flex", flexDirection: "column", gap: 28 }}>
        <Link href="/" aria-label="Altron home" style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--text)" }}>
          <Mark size={22} />
          <span style={{ fontSize: 18, fontWeight: 500, letterSpacing: "-0.02em" }}>Altron</span>
        </Link>
        <h1 style={{ margin: 0, fontFamily: "var(--serif)", fontWeight: 400, fontSize: 52, lineHeight: 1 }}>Risk disclosure</h1>
        <p style={{ margin: 0, fontSize: 16, lineHeight: 1.7, color: "var(--soft)" }}>
          Futures trading involves substantial risk of loss and is not suitable for every investor. Altron shares one
          trader’s positions for education and transparency. Nothing on this site is investment advice, and past results
          do not guarantee future results.
        </p>
        <p style={{ margin: 0, fontSize: 16, lineHeight: 1.7, color: "var(--soft)" }}>
          Prices, positions and trade history shown on the public site are simulated demonstration data.
        </p>
      </div>
    </main>
  );
}
