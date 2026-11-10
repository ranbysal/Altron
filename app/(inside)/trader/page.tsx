import type { Metadata } from "next";
import { FeedProvider } from "@/components/landing/FeedProvider";
import { Dashboard } from "@/components/trader/Dashboard";

export const metadata: Metadata = {
  title: "Dashboard · Altron",
  robots: { index: false },
};

export default function TraderPage() {
  return (
    <FeedProvider>
      <Dashboard />
    </FeedProvider>
  );
}
