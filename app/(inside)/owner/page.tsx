import type { Metadata } from "next";
import { OwnerDashboard } from "@/components/owner/OwnerDashboard";

export const metadata: Metadata = {
  title: "Dashboard · Altron",
  robots: { index: false },
};

export default function OwnerPage() {
  return <OwnerDashboard />;
}
