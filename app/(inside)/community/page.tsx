import type { Metadata } from "next";
import { Community } from "@/components/community/Community";

export const metadata: Metadata = {
  title: "Community · Altron",
  robots: { index: false },
};

export default function CommunityPage() {
  return <Community />;
}
