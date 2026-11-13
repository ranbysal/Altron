import type { Metadata } from "next";
import { OwnerDesk } from "@/components/owner/OwnerDesk";

export const metadata: Metadata = {
  title: "Desk · Altron",
  robots: { index: false },
};

export default function OwnerDeskPage() {
  return <OwnerDesk />;
}
