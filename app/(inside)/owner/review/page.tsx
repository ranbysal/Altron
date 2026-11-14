import type { Metadata } from "next";
import { Review } from "@/components/owner/Review";

export const metadata: Metadata = {
  title: "Review · Altron",
  robots: { index: false },
};

export default function ReviewPage() {
  return <Review />;
}
