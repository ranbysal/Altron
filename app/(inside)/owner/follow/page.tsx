import type { Metadata } from "next";
import { Follow } from "@/components/owner/Follow";

export const metadata: Metadata = {
  title: "Follow · Altron",
  robots: { index: false },
};

export default function FollowPage() {
  return <Follow />;
}
