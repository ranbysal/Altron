import type { Metadata } from "next";
import { IdentityView } from "@/components/identity/IdentityView";

export const metadata: Metadata = {
  title: "Identity — Altron",
  robots: { index: false },
};

export default function IdentityPage() {
  return <IdentityView />;
}
