import type { Metadata } from "next";
import { Results } from "@/components/owner/Results";

export const metadata: Metadata = {
  title: "Dashboard · Altron",
  robots: { index: false },
};

export default function OwnerPage() {
  return <Results />;
}
